(function() {
  Element.prototype.getFlowText = function(bounds) {
    var renderable = !!(this.offsetWidth || this.offsetHeight || this.getClientRects().length);
    var inflow = !['fixed','absolute','sticky'].some(v => this.style.position==v);
    if (!renderable||!inflow) { return ''; }
    return Array.from(this.childNodes)
      .map(n =>
        n.nodeType === Node.TEXT_NODE ? n.nodeValue
        : n.nodeType === Node.ELEMENT_NODE ? n.getFlowText(bounds)
        : ''
      )
      .join('');
  };

  Element.prototype.assignStyle = function(style) {
    for (var prop in style) {
      this.style[prop] = style[prop];
    }
  }

  class Config {
    static KEY = 'faceblok-config';

    constructor(source) {
      this['mutation-types'] = Config.formatArr(source['mutation-types'])
        .map(v => Config.formatStr(v));

      this['content-blockers'] = Config.formatArr(source['content-blockers'])
        .map(blk => { return {
          'name': Config.formatStr(blk['name']).trim() || 'no name',
          'element-selector': Config.formatStr(blk['element-selector']).trim(),
          'content-selector': Config.formatStr(blk['content-selector']).trim(),
          'content-match': Config.formatStr(blk['content-match']).trim(),
          'mutation-type': Config.formatInt(blk['mutation-type']),
          'mutation-data': Config.formatObj(blk['mutation-data']),
          'flow-text': Config.formatBool(blk['flow-text']),
          'enabled': Config.formatBool(blk['enabled'])
        }});
    }

    save() {
      var setter = {};
      setter[Config.KEY] = JSON.stringify(this);
      return new Promise(r => chrome.storage.sync.set(setter, r));
    }

    static load() {
      return fetch(chrome.runtime.getURL('config.json'))
        .then(re => re.json())
        .then(json =>
          new Promise(r => chrome.storage.sync.get([Config.KEY],r))
            .then(sync => JSON.parse((sync||{})[Config.KEY]||'{}'))
            .then(sync => Object.assign(json, sync))
        )
        .then(source => new Config(source))
    }

    static formatInt(v) { try { return parseInt(v); } catch { return 0; } }
    static formatStr(v) { return (v==null?'':v).toString(); }
    static formatArr(v) { return Array.from(v==null?[]:v); }
    static formatObj(v) { return typeof(v)==='object'?v:{}; }
    static formatBool(v) { return !!v; }
  }

  class HoverControl {
    constructor(element, style) {
      var restore = Object
        .keys(style)
        .reduce((o,k) => (o[k]=element.style[k])&&o||o,{});
      function mutate() { element.assignStyle(style); }
      function unmutate() { element.assignStyle(restore); }
      element.hoverControl = this;
      element.addEventListener('mouseover', unmutate);
      element.addEventListener('mouseout', mutate);
      mutate();
    }

    static attach(element, style) {
      return element.hoverControl||new HoverControl(element, style);
    }
  }

  function scan(config) {
    const tooSoon = 1000*1;
    if (document.suspendScan) { return; }
    if (document.lastScan&&(document.lastScan+tooSoon>(new Date().valueOf()))) { return; }
    console.log('scan');
    document.lastScan = new Date().valueOf();
    document.suspendScan = true;
    config['content-blockers']
      .forEach(blocker => { try {
        Array.from(document.querySelectorAll(blocker['element-selector']))
          .map(e => { return {
            element: e,
            content: Array.from(e.querySelectorAll(blocker['content-selector'])),
            regexp: blocker['content-match']?new RegExp(blocker['content-match'], 'i'):false
          }})
          .filter(target => {
            if (blocker['content-selector']&&!target.content.length) { return false; }
            if (!target.regexp) { return true; }
            var content = blocker['content-selector']?target.content:[target.element];
            if (content.some(e => e.textContent.match(target.regexp))) { return true; }
            if (!config['flow-text']) { return false; }
            return content.some(e => e.getFlowText().match(target.regexp));
          })
          .forEach(match => {
            var mutation = config['mutation-types'][blocker['mutation-type']]
            switch(mutation) {
              case 'style':
                match.element.assignStyle(blocker['mutation-data'])
                break;
              case 'hover':
                HoverControl.attach(match.element, blocker['mutation-data']);
                break;
              case 'remove':
                match.element.parentNode.removeChild(match.element);
                break;
              default:
                console.error('faceblok', 'content-blockers', blocker.name, 'unknown mutation', mutation);
                break;
            }
          });
      } catch(error) {
        console.log('content-blockers', blocker, error);
      } });
    setTimeout(() => document.suspendScan = false, 1);
  }

  Config.load()
    .then(config => {
      document.observer = new MutationObserver(
        () => scan(config)
      )
      .observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      scan(config);
      setTimeout(() => scan(config), 5*1000);
    })
    .catch(error => {
      alert('Faceblok is broken!\n(this can be uninstalled at "... -> More Tools -> Extensions")');
      console.error('Faceblok is broken!', error);
    });
})();
