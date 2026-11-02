/**
 * 小程序预览器 · 浏览器端运行时
 * 能力范围：WXML 编译、数据绑定、wx:if/for、事件、setData、
 *           页面栈、tabBar、wx.* 常用 API、WXSS rpx 换算
 * 说明：这是本地预览工具，用于开发期快速查看，不能替代真机与开发者工具。
 */
(function () {
  var RATIO = 390 / 750; // 750rpx = 390px 屏幕宽

  var state = {
    appConfig: null,
    appInstance: null,
    appWxss: '',
    stack: [],
    modules: {},
    uid: 0,
    loading: false,
    composing: false,
    pendingRender: false,
    toastTimer: null
  };

  var exprCache = new Map();
  var VOID = new Set(['input', 'image', 'switch', 'icon', 'slider', 'checkbox', 'radio', 'progress']);

  var PAGE_LABELS = {
    'pages/index/index': '工作台',
    'pages/projects/projects': '项目列表',
    'pages/materials/materials': '技术素材库',
    'pages/mine/mine': '我的',
    'pages/create/create': '新建技术标',
    'pages/parsing/parsing': 'AI 解析中',
    'pages/analysis/analysis': '技术标解析报告',
    'pages/blueprint/blueprint': '施工图与要素表',
    'pages/outline/outline': '技术标大纲',
    'pages/generating/generating': 'AI 生成中',
    'pages/fill/fill': '待补字段',
    'pages/elements/elements': '完整要素表',
    'pages/chapter/chapter': '章节编辑',
    'pages/check/check': '导出前自检',
    'pages/export/export': '导出技术标'
  };

  var dom = {};

  /* ============================================================
     表达式与数据
     ============================================================ */

  function evalExpr(expr, scope) {
    var code = String(expr).trim();
    var fn = exprCache.get(code);
    if (!fn) {
      try {
        fn = new Function('scope', 'with(scope){return (' + code + ');}');
      } catch (e) {
        console.warn('[表达式编译失败]', code, e.message);
        fn = function () { return undefined; };
      }
      exprCache.set(code, fn);
    }
    try {
      return fn(scope);
    } catch (e) {
      return undefined;
    }
  }

  // <template is="x" data="{{a: 1, ...obj}}" /> 的 data 是对象字面量，不是普通表达式
  function evalTemplateData(raw, scope) {
    if (!raw) return {};
    var s = String(raw).trim();
    var m = s.match(/^\{\{([\s\S]*)\}\}$/);
    var body = m ? m[1].trim() : s;
    if (!body) return {};
    try {
      var obj = new Function('scope', 'with(scope){return ({' + body + '});}')(scope);
      if (obj && typeof obj === 'object') return obj;
    } catch (e) {}
    var v = evalExpr(body, scope);
    return v && typeof v === 'object' ? v : {};
  }

  function interp(str, scope) {
    if (str == null) return '';
    str = String(str);
    if (str.indexOf('{{') < 0) return str;
    return str.replace(/\{\{([\s\S]+?)\}\}/g, function (_, expr) {
      var v = evalExpr(expr, scope);
      return v === undefined || v === null ? '' : v;
    });
  }

  function attrVal(raw, scope) {
    if (raw == null) return '';
    var m = String(raw).match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (m) return evalExpr(m[1], scope);
    return interp(raw, scope);
  }

  function setByPath(obj, path, value) {
    var keys = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
    var cur = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function clone(o) {
    try { return JSON.parse(JSON.stringify(o || {})); } catch (e) { return {}; }
  }

  /* ============================================================
     WXML 解析
     ============================================================ */

  function parseAttrs(str) {
    var attrs = {};
    var re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*"([^"]*)")?/g;
    var m;
    while ((m = re.exec(str))) {
      attrs[m[1]] = m[2] === undefined ? '' : m[2];
    }
    return attrs;
  }

  function parseWXML(src) {
    var root = { tag: 'root', attrs: {}, children: [] };
    var stack = [root];
    var i = 0;

    function pushText(txt) {
      if (!txt) return;
      stack[stack.length - 1].children.push({ tag: '#text', text: txt });
    }

    while (i < src.length) {
      var lt = src.indexOf('<', i);
      if (lt < 0) { pushText(src.slice(i)); break; }
      if (lt > i) pushText(src.slice(i, lt));

      if (src.substr(lt, 4) === '<!--') {
        var cend = src.indexOf('-->', lt);
        i = cend < 0 ? src.length : cend + 3;
        continue;
      }

      if (src[lt + 1] === '/') {
        var gt0 = src.indexOf('>', lt);
        stack.pop();
        i = gt0 + 1;
        continue;
      }

      // 找到标签结束位置（跳过引号内的 >）
      var j = lt + 1, quote = null;
      while (j < src.length) {
        var c = src[j];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }

      var raw = src.slice(lt + 1, j);
      var selfClose = /\/\s*$/.test(raw);
      if (selfClose) raw = raw.replace(/\/\s*$/, '');

      var nm = raw.match(/^([a-zA-Z][\w-]*)/);
      if (!nm) { i = j + 1; continue; }

      var tag = nm[1];
      var node = { tag: tag, attrs: parseAttrs(raw.slice(nm[0].length)), children: [] };
      stack[stack.length - 1].children.push(node);

      if (!selfClose && !VOID.has(tag)) stack.push(node);
      i = j + 1;
    }
    return root;
  }

  /* ============================================================
     模板：支持 <import src> / <include src> / <template is>
     真机由微信编译器处理，这里等价实现一遍
     ============================================================ */

  function resolveSrc(src, pagePath) {
    if (src.charAt(0) === '/') return src.slice(1);
    var dir = pagePath.split('/').slice(0, -1).join('/');
    var parts = ((dir ? dir + '/' : '') + src).split('/');
    var out = [];
    parts.forEach(function (p) {
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    });
    return out.join('/');
  }

  function extractTemplates(ast) {
    var map = {};
    (function walk(nodes) {
      nodes.forEach(function (n) {
        if (n.tag === 'template' && n.attrs && n.attrs.name) map[n.attrs.name] = n.children;
        if (n.children) walk(n.children);
      });
    })(ast.children);
    return map;
  }

  function attachTemplates(ast, pagePath) {
    var refs = [];
    (function walk(nodes) {
      for (var i = nodes.length - 1; i >= 0; i--) {
        var n = nodes[i];
        if (n.tag === 'import' || n.tag === 'include') {
          n.__ref = refs.length + 1;
          refs.push(n);
        } else if (n.children && n.children.length) {
          walk(n.children);
        }
      }
    })(ast.children);

    if (!refs.length) return Promise.resolve({ ast: ast, templates: {} });

    return Promise.all(refs.map(function (n) {
      var url = '/api/module?path=' + encodeURIComponent(resolveSrc(n.attrs.src || '', pagePath));
      return getText(url)
        .then(function (txt) { return { node: n, ast: parseWXML(txt) }; })
        .catch(function () { return { node: n, ast: { children: [] } }; });
    })).then(function (list) {
      var templates = {};
      var byRef = {};
      list.forEach(function (item) {
        byRef[item.node.__ref] = item;
        var tpls = extractTemplates(item.ast);
        for (var k in tpls) if (!templates[k]) templates[k] = tpls[k];
      });

      function rebuild(nodes) {
        var out = [];
        nodes.forEach(function (n) {
          if (n.__ref && byRef[n.__ref]) {
            var item = byRef[n.__ref];
            if (n.tag === 'include') {
              out = out.concat(rebuild(item.ast.children.filter(function (c) {
                return c.tag !== 'template' && c.tag !== 'wxs';
              })));
            }
            return; // import：定义已收集，节点本身不渲染
          }
          if (n.children && n.children.length) n.children = rebuild(n.children);
          out.push(n);
        });
        return out;
      }

      ast.children = rebuild(ast.children);
      return { ast: ast, templates: templates };
    });
  }

  /* ============================================================
     渲染
     ============================================================ */

  function currentEntry() {
    return state.stack[state.stack.length - 1];
  }

  function currentInst() {
    var e = currentEntry();
    return e ? e.inst : null;
  }

  function isTextTag(node) {
    return node && node.tag === 'text';
  }

  function renderNodes(nodes, scope, parent, parentNode) {
    var chainActive = false;
    var chainMatched = false;

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      if (node.tag === '#text') {
        var txt = interp(node.text, scope);
        if (!txt.trim() && !isTextTag(parentNode)) continue;
        parent.appendChild(document.createTextNode(txt));
        continue;
      }

      var a = node.attrs;

      if ('wx:if' in a) {
        chainActive = true;
        chainMatched = !!attrVal(a['wx:if'], scope);
        if (!chainMatched) continue;
      } else if ('wx:elif' in a) {
        if (!chainActive || chainMatched) continue;
        chainMatched = !!attrVal(a['wx:elif'], scope);
        if (!chainMatched) continue;
      } else if ('wx:else' in a) {
        if (!chainActive || chainMatched) continue;
        chainMatched = true;
      } else {
        chainActive = false;
        chainMatched = false;
      }

      if ('wx:for' in a) {
        var list = attrVal(a['wx:for'], scope) || [];
        var itemName = a['wx:for-item'] || 'item';
        var idxName = a['wx:for-index'] || 'index';
        if (!Array.isArray(list)) list = [];
        for (var k = 0; k < list.length; k++) {
          var s = Object.create(scope);
          s[itemName] = list[k];
          s[idxName] = k;
          renderOne(node, s, parent);
        }
        continue;
      }

      renderOne(node, scope, parent);
    }
  }

  function renderOne(node, scope, parent) {
    var a = node.attrs;

    if (node.tag === 'import' || node.tag === 'include') return;

    if (node.tag === 'template') {
      var tpl = state.templates && state.templates[a.is];
      if (!tpl) return;
      var data = evalTemplateData(a.data, scope);
      var ts = Object.create(scope);
      for (var dk in data) ts[dk] = data[dk];
      renderNodes(tpl, ts, parent, node);
      return;
    }

    if (node.tag === 'block') {
      renderNodes(node.children, scope, parent, node);
      return;
    }

    var el = document.createElement(node.tag);
    el.setAttribute('data-mp-id', 'n' + (++state.uid));

    // class / style
    if (a.class) el.className = interp(a.class, scope);
    if (a.style) el.setAttribute('style', interp(a.style, scope));

    // button 的 disabled（真机原生支持，这里补上，否则置灰按钮仍可点）
    if (node.tag === 'button' && 'disabled' in a) {
      el.disabled = !!attrVal(a.disabled, scope);
    }

    // dataset（保留原始类型，和微信一致）
    var ds = {};
    for (var key in a) {
      if (key.indexOf('data-') === 0) {
        var dk = key.slice(5).replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); });
        ds[dk] = attrVal(a[key], scope);
      }
    }
    el.__ds = ds;

    // ---- 组件差异处理 ----
    if (node.tag === 'switch') {
      var checked = !!attrVal(a.checked, scope);
      var color = a.color || '#04BE02';
      el.className = (el.className ? el.className + ' ' : '') + 'mp-switch' + (checked ? ' on' : '');
      el.style.background = checked ? color : '#E5E5E5';
      el.innerHTML = '<i></i>';
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var now = !el.classList.contains('on');
        el.classList.toggle('on', now);
        el.style.background = now ? color : '#E5E5E5';
        if (a.bindchange) {
          callMethod(a.bindchange, {
            type: 'change',
            currentTarget: { dataset: ds },
            target: { dataset: ds },
            detail: { value: now }
          });
        }
      });
    } else if (node.tag === 'input' || node.tag === 'textarea') {
      if (a.placeholder) el.setAttribute('placeholder', interp(a.placeholder, scope));
      var val = attrVal(a.value, scope);
      if (val !== undefined && val !== null) el.value = val;
      if ('maxlength' in a && a.maxlength !== '-1') el.setAttribute('maxlength', a.maxlength);
      if (node.tag === 'textarea' && 'auto-height' in a) {
        el.setAttribute('rows', '2');
        el.setAttribute('data-autoheight', '1');
        el.style.height = 'auto';
      }
      if (a.bindinput) {
        var fire = function (value) {
          callMethod(a.bindinput, {
            type: 'input',
            currentTarget: { dataset: ds },
            target: { dataset: ds },
            detail: { value: value }
          });
        };
        el.addEventListener('input', function (ev) {
          if (node.tag === 'textarea' && 'auto-height' in a) {
            ev.target.style.height = 'auto';
            ev.target.style.height = ev.target.scrollHeight + 'px';
          }
          // 中文输入法拼写过程中不回调：此时 setData 会重建 DOM，直接打断输入法
          if (state.composing || ev.isComposing) return;
          fire(ev.target.value);
        });
        el.addEventListener('compositionstart', function () {
          state.composing = true;
        });
        el.addEventListener('compositionend', function (ev) {
          state.composing = false;
          fire(ev.target.value);
          if (state.pendingRender) {
            state.pendingRender = false;
            renderPage(false);
          }
        });
      }
    } else if (node.tag === 'scroll-view') {
      if ('scroll-x' in a) {
        el.style.overflowX = 'auto';
        el.style.overflowY = 'hidden';
      }
    }

    // ---- 事件 ----
    var tap = a.bindtap || a.catchtap;
    if (tap) {
      el.addEventListener('click', function (ev) {
        if (a.catchtap) ev.stopPropagation();
        callMethod(tap, {
          type: 'tap',
          currentTarget: { dataset: ds },
          target: { dataset: ds },
          detail: {}
        });
      });
    }

    if (node.children.length) renderNodes(node.children, scope, el, node);
    parent.appendChild(el);
  }

  function callMethod(name, ev) {
    var inst = currentInst();
    if (!inst) return;
    var fn = inst[name];
    if (typeof fn !== 'function') {
      console.warn('[未找到事件处理函数]', name);
      return;
    }
    try {
      fn(ev);
    } catch (e) {
      console.error('[事件异常] ' + name, e);
      toast('运行出错：' + e.message);
    }
  }

  /* ============================================================
     WXSS 转换
     ============================================================ */

  function transformCSS(css) {
    if (!css) return '';
    return css
      .replace(/(-?\d*\.?\d+)rpx/g, function (_, n) {
        return (parseFloat(n) * RATIO).toFixed(2) + 'px';
      })
      .replace(/(^|\})\s*page\s*\{/gm, '$1.mp-page{')
      // 全局滚动条隐藏只该作用于手机屏内，否则会把预览器侧栏的滚动条也吃掉
      .replace(/(^|\}|\*\/)[ \t]*::-webkit-scrollbar/gm, function (_, pre) {
        return pre + '.mp-page ::-webkit-scrollbar';
      });
  }

  function applyAppStyle() {
    var st = document.getElementById('mp-app-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'mp-app-style';
      document.head.appendChild(st);
    }
    st.textContent = transformCSS(state.appWxss);
  }

  function applyPageStyle(css) {
    var st = document.getElementById('mp-page-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'mp-page-style';
      document.head.appendChild(st);
    }
    st.textContent = transformCSS(css);
  }

  /* ============================================================
     页面渲染与生命周期
     ============================================================ */

  function renderPage(resetScroll) {
    var entry = currentEntry();
    if (!entry || !dom.content) return;

    // 输入法拼写中不重建 DOM，否则会把正在输入的候选字清掉
    if (state.composing) {
      state.pendingRender = true;
      return;
    }

    var active = document.activeElement;
    var focusId = null;
    var caret = null;
    if (active && dom.content.contains(active)) {
      focusId = active.getAttribute('data-mp-id');
      try { caret = active.selectionStart; } catch (e) {}
    }

    var keep = resetScroll ? 0 : dom.content.scrollTop;

    state.uid = 0;
    state.templates = entry.templates || {};
    dom.content.innerHTML = '';
    try {
      renderNodes(entry.ast.children, entry.inst.data, dom.content, entry.ast);
    } catch (e) {
      console.error('[渲染异常]', e);
      dom.content.innerHTML = '<div style="padding:40px;color:#F53F3F;font-size:13px;line-height:1.8">页面渲染出错<br>' + e.message + '</div>';
    }
    dom.content.scrollTop = keep;
    fitAutoHeight();

    if (focusId) {
      var next = dom.content.querySelector('[data-mp-id="' + focusId + '"]');
      if (next && (next.tagName === 'INPUT' || next.tagName === 'TEXTAREA')) {
        try {
          next.focus();
          if (caret != null) next.setSelectionRange(caret, caret);
        } catch (e) {}
      }
    }

    updateNav(entry);
    updateTabbar(entry);
  }

  // auto-height 的 textarea 必须挂到 DOM 之后才知道内容高度，统一在渲染末尾撑开
  function fitAutoHeight() {
    if (!dom.content) return;
    var list = dom.content.querySelectorAll('textarea[data-autoheight]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }

  function updateNav(entry) {
    var j = entry.json || {};
    var win = (state.appConfig && state.appConfig.window) || {};
    var title = j.navigationBarTitleText || win.navigationBarTitleText || '';
    var bg = j.navigationBarBackgroundColor || win.navigationBarBackgroundColor || '#F5F7FB';
    var light = (j.navigationBarTextStyle || win.navigationBarTextStyle) === 'white';

    dom.navbar.style.background = bg;
    dom.navbar.style.color = light ? '#ffffff' : '#1D2129';
    dom.navtitle.textContent = title;
    dom.navback.style.display =
      state.stack.length > 1 || FLOW_PARENT[entry.path] ? 'flex' : 'none';
  }

  function updateTabbar(entry) {
    var list = (state.appConfig && state.appConfig.tabBar && state.appConfig.tabBar.list) || [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].pagePath === entry.path) { idx = i; break; }
    }
    dom.tabbar.style.display = idx >= 0 ? 'flex' : 'none';
    dom.content.style.bottom = idx >= 0 ? 'calc(var(--tabbar-height) + 2 * var(--tabbar-inset))' : '0px';
    var kids = dom.tabbar.querySelectorAll('.tb');
    for (var n = 0; n < kids.length; n++) {
      kids[n].classList.toggle('on', n === idx);
      var ico = kids[n].querySelector('.ico');
      if (ico && list[n]) {
        if (ico.tagName === 'IMG') {
          ico.src = (n === idx) ? (list[n].selectedIconPath || list[n].iconPath) : list[n].iconPath;
        } else {
          ico.innerHTML = (n === idx) ? (list[n].selectedIconPath || list[n].iconPath) : list[n].iconPath;
        }
      }
    }
  }

  function buildTabbar() {
    var list = (state.appConfig.tabBar && state.appConfig.tabBar.list) || [];
    dom.tabbar.innerHTML = '';
    var inner = document.createElement('div');
    inner.className = 'mp-tabbar-inner';
    list.forEach(function (item) {
      var d = document.createElement('div');
      d.className = 'tb';
      var icon = '';
      if (item.iconPath) {
        var svg = item.iconPath;
        if (svg.indexOf('<svg') === 0) {
          icon = '<span class="ico">' + svg + '</span>';
        } else {
          icon = '<img class="ico" src="' + svg + '">';
        }
      }
      d.innerHTML = icon + '<span>' + item.text + '</span>';
      d.addEventListener('click', function () {
        openPage(item.pagePath, 'switch');
      });
      inner.appendChild(d);
    });
    dom.tabbar.appendChild(inner);
  }

  /* ============================================================
     页面加载与导航
     ============================================================ */

  function getJSON(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }

  function getText(url) {
    return fetch(url).then(function (r) { return r.text(); });
  }

  function requireShim(p) {
    if (String(p).indexOf('service') >= 0) return state.modules.service;
    if (String(p).indexOf('mock') >= 0) return state.modules.mock;
    throw new Error('预览器暂不支持该模块：' + p);
  }

  function loadPage(path) {
    return getJSON('/api/page?path=' + encodeURIComponent(path)).then(function (d) {
      var cfg = null;
      try {
        new Function('Page', 'require', 'getApp', 'wx', 'console', d.js)(
          function (c) { cfg = c; },
          requireShim,
          getApp,
          wxShim,
          console
        );
      } catch (e) {
        console.error('[页面脚本异常] ' + path, e);
        toast('脚本异常：' + e.message);
      }
      if (!cfg) cfg = { data: {} };

      return attachTemplates(parseWXML(d.wxml || ''), path).then(function (t) {
        return {
          path: path,
          cfg: cfg,
          json: d.json ? JSON.parse(d.json) : {},
          ast: t.ast,
          templates: t.templates,
          wxss: d.wxss || ''
        };
      });
    });
  }

  function createInstance(cfg, path) {
    var inst = {
      route: path,
      data: clone(cfg.data),
      getTabBar: function () { return { setData: function () {} }; }
    };

    inst.setData = function (patch, cb) {
      for (var k in patch) setByPath(inst.data, k, patch[k]);
      if (cb) cb();
      var cur = currentEntry();
      if (cur && cur.inst === inst) renderPage(false);
    };

    Object.keys(cfg).forEach(function (k) {
      if (typeof cfg[k] === 'function') inst[k] = cfg[k].bind(inst);
    });

    return inst;
  }

  function openPage(path, mode, query) {
    if (state.loading) return;
    state.loading = true;

    loadPage(path).then(function (page) {
      var inst = createInstance(page.cfg, path);
      // wxss 必须随 entry 一起存：返回上一页时要靠它把样式换回去
      var entry = {
        path: path, inst: inst, json: page.json,
        ast: page.ast, wxss: page.wxss, templates: page.templates
      };

      if (mode === 'push') {
        var prev = currentEntry();
        if (prev && prev.inst.onHide) { try { prev.inst.onHide(); } catch (e) {} }
        state.stack.push(entry);
      } else if (mode === 'replace') {
        var old = state.stack.pop();
        if (old && old.inst.onUnload) { try { old.inst.onUnload(); } catch (e) {} }
        state.stack.push(entry);
      } else {
        state.stack.forEach(function (e) {
          if (e.inst.onUnload) { try { e.inst.onUnload(); } catch (err) {} }
        });
        state.stack = [entry];
      }

      applyPageStyle(page.wxss);

      if (inst.onLoad) { try { inst.onLoad(query || {}); } catch (e) { console.error(e); } }
      if (inst.onShow) { try { inst.onShow(); } catch (e) { console.error(e); } }

      renderPage(true);
      markSideActive(path);
      state.loading = false;
    }).catch(function (e) {
      console.error(e);
      state.loading = false;
      toast('页面加载失败：' + e.message);
    });
  }

  // 主链路的上一页。从侧栏/直链进入某页时栈里只有一页，靠它兜底返回，
  // 否则审页面时会卡在「没有返回箭头」的死角（真机走的是真实页面栈）
  var FLOW_PARENT = {
    'pages/projects/projects': 'pages/index/index',
    'pages/materials/materials': 'pages/index/index',
    'pages/mine/mine': 'pages/index/index',
    'pages/create/create': 'pages/index/index',
    'pages/parsing/parsing': 'pages/create/create',
    'pages/analysis/analysis': 'pages/create/create',
    'pages/blueprint/blueprint': 'pages/analysis/analysis',
    'pages/outline/outline': 'pages/blueprint/blueprint',
    'pages/generating/generating': 'pages/outline/outline',
    'pages/fill/fill': 'pages/generating/generating',
    'pages/elements/elements': 'pages/blueprint/blueprint',
    'pages/chapter/chapter': 'pages/fill/fill',
    'pages/check/check': 'pages/chapter/chapter',
    'pages/export/export': 'pages/check/check'
  };

  function back() {
    if (state.stack.length > 1) {
      var top = state.stack.pop();
      if (top.inst.onUnload) { try { top.inst.onUnload(); } catch (e) {} }
      var prev = currentEntry();
      applyPageStyle(prev.wxss || '');
      if (prev.inst.onShow) { try { prev.inst.onShow(); } catch (e) {} }
      renderPage(false);
      markSideActive(prev.path);
      return;
    }
    var cur = currentEntry();
    var parent = cur && FLOW_PARENT[cur.path];
    if (parent) openPage(parent, 'switch');
  }

  function normalize(url) {
    return String(url).replace(/^\//, '').split('?')[0];
  }

  /* ============================================================
     wx API 模拟
     ============================================================ */

  // 真机是微信原生弹窗；预览器用页面内的仿微信弹窗，避免 window.confirm 阻塞且样式不符
  function showModalUI(o) {
    if (o.editable) {
      var content = window.prompt(o.title || '请输入', o.content || '');
      if (o.success) o.success({confirm: content !== null, cancel: content === null, content: content || ''});
      return;
    }
    if (!dom.modal) {
      var ok = window.confirm((o.title ? o.title + '\n' : '') + (o.content || ''));
      if (o.success) o.success({ confirm: ok, cancel: !ok });
      return;
    }
    dom.modalTitle.textContent = o.title || '提示';
    dom.modalBody.textContent = o.content || '';
    dom.modalOk.textContent = o.confirmText || '确定';
    dom.modalCancel.textContent = o.cancelText || '取消';
    dom.modalCancel.style.display = o.showCancel === false ? 'none' : 'flex';
    dom.modal.classList.add('on');

    function done(confirmed) {
      dom.modal.classList.remove('on');
      dom.modalOk.onclick = null;
      dom.modalCancel.onclick = null;
      dom.modalMask.onclick = null;
      if (o.success) o.success({ confirm: confirmed, cancel: !confirmed });
    }

    dom.modalOk.onclick = function () { done(true); };
    dom.modalCancel.onclick = function () { done(false); };
    dom.modalMask.onclick = function () { done(false); };
  }

  function toast(msg) {
    if (!dom.toast) return;
    dom.toast.textContent = msg;
    dom.toast.classList.add('on');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      dom.toast.classList.remove('on');
    }, 1600);
  }

  var fileCache = new Map();
  function localUrl(url) { var u = new URL(url, location.origin); return u.pathname + u.search; }

  var wxShim = {
    showToast: function (o) {
      toast((o && (o.title || o.content)) || '');
      if (o && o.success) setTimeout(o.success, 100);
    },
    hideToast: function () { dom.toast.classList.remove('on'); },
    showLoading: function (o) { toast((o && o.title) || '加载中'); },
    hideLoading: function () { dom.toast.classList.remove('on'); },
    showModal: function (o) { showModalUI(o || {}); },
    showActionSheet: function(o) { var choice=window.prompt(o.itemList.map(function(s,i){return (i+1)+'. '+s;}).join('\n'),''); var index=Number(choice)-1;if(choice!==null&&choice!==''&&Number.isInteger(index)&&index>=0&&index<o.itemList.length){if(o.success)o.success({tapIndex:index});}else if(o.fail)o.fail({errMsg:'showActionSheet:fail cancel'}); },
    pageScrollTo: function(o) { var target=o.selector&&document.querySelector(o.selector);if(target)target.scrollIntoView({behavior:'smooth',block:'start'});if(o.success)o.success({}); },
    navigateTo: function (o) { openPage(normalize(o.url), 'push'); if (o.success) setTimeout(o.success, 50); },
    redirectTo: function (o) { openPage(normalize(o.url), 'replace'); if (o.success) setTimeout(o.success, 50); },
    switchTab: function (o) { openPage(normalize(o.url), 'switch'); if (o.success) setTimeout(o.success, 50); },
    navigateBack: function (o) { back(); if (o && o.success) setTimeout(o.success, 50); },
    chooseMessageFile: function (o) {
      var input = document.createElement('input'); input.type = 'file'; input.multiple = o.count > 1;
      input.accept = (o.extension || ['pdf','docx','txt']).map(function(x){return '.'+x;}).join(',');
      // 挂到 DOM 上，便于自动化脚本用 CDP 注入文件；不显示也不影响视觉
      input.style.position = 'fixed'; input.style.left = '-9999px'; input.style.top = '0';
      input.setAttribute('data-pv-file-input', '1');
      document.body.appendChild(input);
      input.onchange = function () {
        var files = Array.from(input.files || []).slice(0, o.count || 1).map(function(f) {
          var key = 'upload-' + Date.now() + '-' + Math.random(); fileCache.set(key,f); return {name:f.name,size:f.size,path:key};
        });
        if (input.parentNode) input.parentNode.removeChild(input);
        if (files.length && o.success) o.success({tempFiles:files}); else if (o.fail) o.fail({errMsg:'取消选择'});
      };
      input.click();
    },
    request: function(o) {
      var controller = new AbortController(), timer = setTimeout(function(){controller.abort();},o.timeout||60000);
      fetch(localUrl(o.url), {method:o.method||'GET', headers:Object.assign({'content-type':'application/json'},o.header||{}), body:o.data===undefined?undefined:JSON.stringify(o.data),signal:controller.signal})
        .then(async function(r){var data=await r.json(); if(o.success)o.success({statusCode:r.status,data:data});})
        .catch(function(e){if(o.fail)o.fail(e);}).finally(function(){clearTimeout(timer);});
    },
    uploadFile: function(o) {
      var file=fileCache.get(o.filePath); if(!file){if(o.fail)o.fail({errMsg:'文件失效，请重新选择'});return;}
      var form=new FormData(); form.append(o.name||'file',file,file.name);
      fetch(localUrl(o.url),{method:'POST',headers:o.header||{},body:form}).then(async function(r){if(o.success)o.success({statusCode:r.status,data:await r.text()});}).catch(function(e){if(o.fail)o.fail(e);});
    },
    downloadFile: function(o) {
      fetch(localUrl(o.url),{headers:o.header||{}}).then(async function(r){
        if(!r.ok){if(o.success)o.success({statusCode:r.status});return;}
        var url=URL.createObjectURL(await r.blob()); if(o.success)o.success({statusCode:r.status,tempFilePath:url});
      }).catch(function(e){if(o.fail)o.fail(e);});
    },
    openDocument: function(o) {
      var a=document.createElement('a');a.href=o.filePath;a.download='技术标.'+(o.fileType==='pdf'?'pdf':'docx');a.click();
      setTimeout(function(){URL.revokeObjectURL(o.filePath);},10000); if(o.success)o.success({});
    },
    getStorageSync: function(k){try{return JSON.parse(localStorage.getItem('bid-'+k));}catch(e){return null;}},
    setStorageSync: function(k,v){localStorage.setItem('bid-'+k,JSON.stringify(v));},
    removeStorageSync: function(k){localStorage.removeItem('bid-'+k);},
    chooseMedia: function (o) {
      setTimeout(function () {
        if (o && o.success) {
          o.success({ tempFiles: [{ size: 2411520, tempFilePath: '#', fileType: 'image' }] });
        }
      }, 200);
    },
    setNavigationBarTitle: function (o) {
      dom.navtitle.textContent = (o && o.title) || '';
    },
    getSystemInfoSync: function () {
      return { windowWidth: 390, windowHeight: 844, pixelRatio: 2, platform: 'devtools' };
    }
  };

  function getApp() {
    return state.appInstance;
  }

  /* ============================================================
     左侧页面列表
     ============================================================ */

  function buildSidePages() {
    var box = document.getElementById('pages');
    box.innerHTML = '';
    (state.appConfig.pages || []).forEach(function (p) {
      var b = document.createElement('button');
      b.dataset.path = p;
      b.innerHTML = '<i></i>' + (PAGE_LABELS[p] || p) + '<em>' + p.replace('pages/', '').replace('/index', '') + '</em>';
      b.addEventListener('click', function () { openPage(p, 'switch'); });
      box.appendChild(b);
    });
  }

  function markSideActive(path) {
    var btns = document.querySelectorAll('#pages button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].dataset.path === path);
    }
  }

  /* ============================================================
     启动
     ============================================================ */

  function boot() {
    dom.content = document.getElementById('content');
    dom.navbar = document.getElementById('navbar');
    dom.navtitle = document.getElementById('navtitle');
    dom.navback = document.getElementById('navback');
    dom.tabbar = document.getElementById('tabbar');
    dom.toast = document.getElementById('toast');
    dom.modal = document.getElementById('modal');
    dom.modalTitle = document.getElementById('modal-title');
    dom.modalBody = document.getElementById('modal-body');
    dom.modalOk = document.getElementById('modal-ok');
    dom.modalCancel = document.getElementById('modal-cancel');
    dom.modalMask = document.getElementById('modal-mask');

    dom.navback.addEventListener('click', back);

    Promise.all([
      getJSON('/api/app'),
      getText('/api/appjs'),
      getText('/api/appwxss'),
      getText('/api/module?path=' + encodeURIComponent('utils/mock.js')),
      getText('/api/module?path=' + encodeURIComponent('utils/service.js'))
    ]).then(function (res) {
      state.appConfig = res[0];
      state.appWxss = res[2];

      // 模块
      var m = { exports: {} };
      try {
        new Function('module', 'exports', res[3])(m, m.exports);
        state.modules.mock = m.exports;
      } catch (e) {
        console.error('[mock.js 加载失败]', e);
      }

      var serviceModule = {exports:{}};
      new Function('module', 'exports', 'wx', 'getApp', res[4])(serviceModule, serviceModule.exports, wxShim, getApp);
      state.modules.service = serviceModule.exports;

      // App
      var appCfg = null;
      try {
        new Function('App', res[1])(function (c) { appCfg = c; });
      } catch (e) {
        console.error('[app.js 加载失败]', e);
      }
      state.appInstance = { globalData: (appCfg && appCfg.globalData) || {} };
      if (appCfg && appCfg.onLaunch) {
        try { appCfg.onLaunch.call(state.appInstance); } catch (e) {}
      }

      applyAppStyle();
      buildSidePages();
      buildTabbar();

      var initial = (location.hash || '').replace('#', '');
      if (!initial) initial = (state.appConfig.pages || [])[0];
      // hash 里可能带前导斜杠（#/pages/xxx），去掉后再请求，否则服务端会 403
      openPage(decodeURIComponent(initial).replace(/^\/+/, ''), 'switch');

      var bootEl = document.getElementById('boot');
      setTimeout(function () {
        bootEl.classList.add('hide');
        setTimeout(function () { bootEl.style.display = 'none'; }, 350);
      }, 200);
    }).catch(function (e) {
      console.error(e);
      document.getElementById('boot').innerHTML =
        '<div style="padding:30px;font-size:13px;color:#F53F3F;line-height:1.8">启动失败：' + e.message +
        '<br><br>请确认已通过 node tools/preview/server.js 启动服务</div>';
    });
  }

  document.getElementById('reload').addEventListener('click', function () {
    location.reload();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
