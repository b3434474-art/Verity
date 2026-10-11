/*!
 * Verity AI voice add-on (powered by Puter.js — free, no API key)
 * Drop into any page with:
 *   <script src="verity-puter.js" defer></script>
 *
 * Optional config (place BEFORE the script tag):
 *   <script>
 *     window.VERITY_CONFIG = {
 *       name: "Verity",
 *       voice: "Joanna",            // Puter TTS voice
 *       autoSpeak: true,            // speak every answer aloud
 *       position: "right",          // "right" | "left"
 *       accent: "#9b5cff",
 *       persona: "..."              // custom personality prompt
 *     };
 *   </script>
 *
 * Use your OWN page elements instead of the floating widget (optional):
 *   <input data-verity-input>      question box
 *   <button data-verity-ask>       ask button
 *   <div data-verity-output>       where answers appear
 *   <button data-verity-signin>    sign-in button (shown when signed out)
 *
 * JavaScript API: window.Verity.ask("question"), Verity.speak("text"),
 *                 Verity.stop(), Verity.open(), Verity.close()
 * Events on window: "verity:answer" {detail:{question, answer}},
 *                   "verity:speaking" / "verity:silent"
 */
(function () {
  if (window.Verity) return;

  var cfg = Object.assign({
    name: 'Verity',
    voice: 'Joanna',
    autoSpeak: true,
    position: 'right',
    accent: '#9b5cff',
    widget: 'auto', // "auto" hides the floating widget if your page has data-verity-input
    persona: null
  }, window.VERITY_CONFIG || {});

  var PERSONA = cfg.persona ||
    'You are ' + cfg.name + ', a spooky but friendly virtual ghost character who haunts this website. ' +
    'You speak with an eerie, playful, mysterious tone — whispery phrases, candlelight, creaking floorboards, the occasional "ooooh" — ' +
    'but you still give genuinely helpful, accurate answers. Keep replies short (2-4 sentences) because they are read aloud. ' +
    'Never use markdown, lists, emojis or code blocks; write plain spoken sentences.';

  var history = [{ role: 'system', content: PERSONA }];
  var currentAudio = null;
  var busy = false;

  /* ---------- Load Puter.js if the page doesn't already have it ---------- */
  var puterReady = new Promise(function (resolve, reject) {
    if (window.puter) return resolve(window.puter);
    var s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.onload = function () { resolve(window.puter); };
    s.onerror = function () { reject(new Error('Could not load Puter.js')); };
    document.head.appendChild(s);
  });

  function isSignedIn() {
    try { return !!(window.puter && puter.auth.isSignedIn()); } catch (e) { return false; }
  }

  function signIn() {
    return puterReady.then(function () { return puter.auth.signIn(); }).then(function () {
      refreshAuth();
    });
  }

  function cleanForSpeech(t) {
    return String(t).replace(/[*_#`>~\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 2900);
  }

  /* ---------- Speech ---------- */
  function stop() {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    emit('verity:silent');
    setSpeaking(false);
  }

  function speak(text) {
    stop();
    var clean = cleanForSpeech(text);
    if (!clean) return Promise.resolve();
    setSpeaking(true);
    emit('verity:speaking', { text: clean });
    return puterReady.then(function () {
      return puter.ai.txt2speech(clean, { voice: cfg.voice, engine: 'neural', language: 'en-US' });
    }).then(function (audio) {
      currentAudio = audio;
      audio.onended = function () { currentAudio = null; setSpeaking(false); emit('verity:silent'); };
      return audio.play();
    }).catch(function () {
      // Free fallback: the browser's built-in voice
      if (!window.speechSynthesis) { setSpeaking(false); return; }
      var u = new SpeechSynthesisUtterance(clean);
      u.rate = 0.92; u.pitch = 0.8;
      u.onend = function () { setSpeaking(false); emit('verity:silent'); };
      speechSynthesis.speak(u);
    });
  }

  /* ---------- Ask ---------- */
  function ask(question, onChunk) {
    question = String(question || '').trim();
    if (!question || busy) return Promise.resolve('');
    if (!isSignedIn()) {
      return Promise.reject(new Error('signin-required'));
    }
    busy = true;
    stop();
    history.push({ role: 'user', content: question });
    var answer = '';
    return puterReady.then(function () {
      return puter.ai.chat(history, { stream: true });
    }).then(async function (stream) {
      for await (var part of stream) {
        if (part && part.text) { answer += part.text; onChunk && onChunk(answer); }
      }
      if (!answer) answer = 'The spirits are silent... try asking again.';
      history.push({ role: 'assistant', content: answer });
      if (history.length > 21) history.splice(1, 2);
      emit('verity:answer', { question: question, answer: answer });
      if (cfg.autoSpeak) speak(answer);
      return answer;
    }).catch(function (err) {
      history.pop();
      throw err;
    }).finally(function () { busy = false; });
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) {}
  }

  /* ---------- Hook into the site's own elements (optional) ---------- */
  var hooks = {};
  function bindPageHooks() {
    hooks.input = document.querySelector('[data-verity-input]');
    hooks.ask = document.querySelector('[data-verity-ask]');
    hooks.output = document.querySelector('[data-verity-output]');
    hooks.signin = document.querySelector('[data-verity-signin]');
    if (hooks.signin) hooks.signin.addEventListener('click', function (e) { e.preventDefault(); signIn(); });
    if (!hooks.input) return false;
    function go() {
      var q = hooks.input.value;
      if (!q.trim()) return;
      if (!isSignedIn()) { if (hooks.output) hooks.output.textContent = 'Sign in with Puter to wake ' + cfg.name + '...'; refreshAuth(); return; }
      hooks.input.value = '';
      if (hooks.output) hooks.output.textContent = '...';
      ask(q, function (t) { if (hooks.output) hooks.output.textContent = t; })
        .catch(function () { if (hooks.output) hooks.output.textContent = 'The connection to the other side was lost. Try again.'; });
    }
    if (hooks.ask) hooks.ask.addEventListener('click', function (e) { e.preventDefault(); go(); });
    hooks.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && hooks.input.tagName !== 'TEXTAREA') { e.preventDefault(); go(); } });
    return true;
  }

  /* ---------- Floating widget (isolated in Shadow DOM so your CSS is untouched) ---------- */
  var ui = {};
  var side = cfg.position === 'left' ? 'left' : 'right';
  var CSS = '\
:host{all:initial}\
*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}\
.fab{position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;border:1px solid #2a2438;background:#120f1a;color:#eae6f5;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .2s}\
.fab:hover{transform:translateY(-2px)}\
.fab svg{width:30px;height:30px;animation:float 3s ease-in-out infinite}\
.panel{position:fixed;bottom:92px;' + side + ':20px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));background:#0d0b13;color:#eae6f5;border:1px solid #2a2438;border-radius:18px;display:none;flex-direction:column;overflow:hidden;z-index:2147483000}\
.panel.open{display:flex;animation:in .2s ease-out}\
.head{display:flex;align-items:center;gap:10px;padding:14px 14px;border-bottom:1px solid #221d2e}\
.ava{width:38px;height:38px;border-radius:50%;background:#1b1626;display:flex;align-items:center;justify-content:center;color:var(--a)}\
.ava svg{width:24px;height:24px}\
.ava.speaking svg{animation:pulse 1s ease-in-out infinite}\
.title{flex:1;min-width:0}\
.title b{display:block;font-size:15px;font-weight:600}\
.title span{font-size:12px;color:#8d85a3}\
.ib{width:32px;height:32px;border-radius:9px;border:0;background:transparent;color:#a39bba;cursor:pointer;display:flex;align-items:center;justify-content:center}\
.ib:hover{background:#1b1626;color:#fff}\
.ib.on{color:var(--a)}\
.ib svg{width:17px;height:17px}\
.msgs{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px}\
.m{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}\
.m.v{background:#1b1626;border:1px solid #2a2438;align-self:flex-start;border-bottom-left-radius:4px}\
.m.u{background:var(--a);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}\
.m .replay{display:inline-flex;margin-top:6px;border:0;background:transparent;color:#8d85a3;cursor:pointer;font-size:12px;gap:4px;align-items:center;padding:0}\
.m .replay:hover{color:#fff}\
.m .replay svg{width:13px;height:13px}\
.dots span{display:inline-block;width:6px;height:6px;border-radius:50%;background:#8d85a3;margin-right:4px;animation:blink 1.2s infinite}\
.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}\
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}\
.chip{border:1px solid #2a2438;background:transparent;color:#c9c2dc;border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer}\
.chip:hover{border-color:var(--a);color:#fff}\
.foot{display:flex;gap:8px;padding:12px;border-top:1px solid #221d2e}\
.foot input{flex:1;min-width:0;background:#15111f;border:1px solid #2a2438;color:#eae6f5;border-radius:11px;padding:11px 12px;font-size:14px;outline:none}\
.foot input:focus{border-color:var(--a)}\
.send{width:42px;border:0;border-radius:11px;background:var(--a);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}\
.send:disabled{opacity:.5;cursor:default}\
.send svg{width:18px;height:18px}\
.gate{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;gap:12px}\
.gate .big{width:72px;height:72px;color:var(--a);animation:float 3s ease-in-out infinite}\
.gate h3{margin:0;font-size:17px;font-weight:600}\
.gate p{margin:0;color:#8d85a3;font-size:13px;line-height:1.5}\
.btn{border:0;background:var(--a);color:#fff;padding:11px 18px;border-radius:11px;font-size:14px;font-weight:500;cursor:pointer}\
.hide{display:none!important}\
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}\
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}\
@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}\
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}';

  var GHOST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>';
  var ICON = {
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>'
  };

  function buildWidget() {
    var host = document.createElement('div');
    host.id = 'verity-widget';
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>' +
      '<div style="--a:' + cfg.accent + '">' +
      '<button class="fab" aria-label="Talk to ' + cfg.name + '">' + GHOST + '</button>' +
      '<div class="panel" role="dialog" aria-label="' + cfg.name + '">' +
        '<div class="head"><div class="ava">' + GHOST + '</div>' +
          '<div class="title"><b>' + cfg.name + '</b><span class="status">Lurking in the shadows</span></div>' +
          '<button class="ib clear" title="Clear conversation">' + ICON.trash + '</button>' +
          '<button class="ib mutebtn" title="Toggle voice"></button>' +
          '<button class="ib closebtn" title="Close">' + ICON.x + '</button></div>' +
        '<div class="gate"><div class="big">' + GHOST + '</div><h3>Summon ' + cfg.name + '</h3>' +
          '<p>Sign in with a free Puter account to ask questions and hear ' + cfg.name + ' speak. No API key needed.</p>' +
          '<button class="btn signin">Sign in to begin</button></div>' +
        '<div class="msgs hide"></div>' +
        '<div class="chips hide"></div>' +
        '<form class="foot hide"><input placeholder="Ask ' + cfg.name + ' anything..." autocomplete="off" maxlength="1000"><button class="send" type="submit" aria-label="Send">' + ICON.send + '</button></form>' +
      '</div></div>';
    var $ = function (s) { return root.querySelector(s); };
    ui = { fab: $('.fab'), panel: $('.panel'), msgs: $('.msgs'), chips: $('.chips'), foot: $('.foot'),
      input: $('.foot input'), send: $('.send'), gate: $('.gate'), signin: $('.signin'),
      mute: $('.mutebtn'), close: $('.closebtn'), clear: $('.clear'), ava: $('.ava'), status: $('.status') };

    ui.fab.onclick = function () { ui.panel.classList.contains('open') ? close() : open(); };
    ui.close.onclick = close;
    ui.signin.onclick = function () { ui.signin.textContent = 'Opening...'; signIn().catch(function () {}).finally(function () { ui.signin.textContent = 'Sign in to begin'; }); };
    ui.mute.onclick = function () { cfg.autoSpeak = !cfg.autoSpeak; if (!cfg.autoSpeak) stop(); renderMute(); };
    ui.clear.onclick = function () { stop(); history = [history[0]]; ui.msgs.innerHTML = ''; greet(); };
    ui.foot.onsubmit = function (e) { e.preventDefault(); sendFromWidget(ui.input.value); };
    ['Who are you?', 'Tell me a ghost story', 'What haunts this place?'].forEach(function (q) {
      var c = document.createElement('button'); c.className = 'chip'; c.textContent = q;
      c.onclick = function () { sendFromWidget(q); }; ui.chips.appendChild(c);
    });
    renderMute();
  }

  function renderMute() {
    if (!ui.mute) return;
    ui.mute.innerHTML = cfg.autoSpeak ? ICON.vol : ICON.mute;
    ui.mute.classList.toggle('on', cfg.autoSpeak);
  }

  function addMsg(who, text) {
    var d = document.createElement('div');
    d.className = 'm ' + who;
    d.textContent = text;
    ui.msgs.appendChild(d);
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
    return d;
  }

  function addReplay(el, text) {
    var b = document.createElement('button');
    b.className = 'replay'; b.innerHTML = ICON.play + 'Hear it';
    b.onclick = function () { speak(text); };
    el.appendChild(document.createElement('br')); el.appendChild(b);
  }

  function greet() {
    var g = 'Ooooh... a visitor. I am ' + cfg.name + '. Ask me anything, if you dare.';
    addReplay(addMsg('v', g), g);
    ui.chips.classList.remove('hide');
  }

  function sendFromWidget(q) {
    q = String(q || '').trim();
    if (!q || busy) return;
    ui.input.value = '';
    ui.chips.classList.add('hide');
    addMsg('u', q);
    var bubble = addMsg('v', '');
    bubble.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
    ui.send.disabled = true;
    ui.status.textContent = 'Consulting the spirits...';
    ask(q, function (t) { bubble.textContent = t; ui.msgs.scrollTop = ui.msgs.scrollHeight; })
      .then(function (ans) { bubble.textContent = ans; addReplay(bubble, ans); })
      .catch(function (err) {
        if (err && err.message === 'signin-required') { refreshAuth(); bubble.remove(); return; }
        bubble.textContent = 'The connection to the other side was lost. Please try again.';
      })
      .finally(function () { ui.send.disabled = false; ui.status.textContent = 'Lurking in the shadows'; ui.input.focus(); });
  }

  function setSpeaking(on) {
    if (ui.ava) { ui.ava.classList.toggle('speaking', on); ui.status.textContent = on ? 'Whispering...' : 'Lurking in the shadows'; }
  }

  function open() { if (!ui.panel) return; ui.panel.classList.add('open'); refreshAuth(); if (isSignedIn()) ui.input.focus(); }
  function close() { if (ui.panel) ui.panel.classList.remove('open'); }

  function refreshAuth() {
    var signed = isSignedIn();
    if (hooks.signin) hooks.signin.style.display = signed ? 'none' : '';
    if (!ui.gate) return;
    ui.gate.classList.toggle('hide', signed);
    ui.msgs.classList.toggle('hide', !signed);
    ui.foot.classList.toggle('hide', !signed);
    if (signed && !ui.msgs.children.length) greet();
    if (!signed) ui.chips.classList.add('hide');
  }

  function init() {
    var hasHooks = bindPageHooks();
    if (cfg.widget === true || (cfg.widget === 'auto' && !hasHooks)) buildWidget();
    puterReady.then(refreshAuth).catch(function () {});
    refreshAuth();
  }

  window.Verity = { ask: ask, speak: speak, stop: stop, open: open, close: close, signIn: signIn, isSignedIn: isSignedIn, config: cfg };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
