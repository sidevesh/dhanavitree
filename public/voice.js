(() => {
  const languages = [
    { code: 'en-IN', name: 'English', native: 'English', tag: 'en' },
    { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी', tag: 'hi' },
    { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ', tag: 'kn' },
  ];
  const mic = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
  let active = null, chooser = null;

  function updateButton(button, listening) {
    button.innerHTML = mic + `<span>${listening ? 'Stop' : 'Voice'}</span>`;
    button.setAttribute('aria-label', listening ? 'Stop voice typing' : 'Use voice typing');
    button.setAttribute('aria-pressed', String(listening));
    button.classList.toggle('listening', listening);
  }

  function write(session, text) {
    if (!session.input.isConnected) return;
    let value = session.original, caret = session.before.length;
    if (text) {
      const left = session.before + (session.before && !/\s$/.test(session.before) ? ' ' : '');
      const right = (session.after && !/^\s/.test(session.after) ? ' ' : '') + session.after;
      const max = session.input.maxLength > 0 ? session.input.maxLength : Infinity;
      const available = Math.max(0, max - left.length - right.length);
      let insertion = text.slice(0, available);
      // Avoid cutting a surrogate pair at the message limit.
      if (/[\uD800-\uDBFF]$/.test(insertion)) insertion = insertion.slice(0, -1);
      if (insertion) { value = left + insertion + right; caret = left.length + insertion.length; }
      if (insertion.length < text.length) session.full = true;
    }
    session.writing = true;
    session.input.value = value;
    session.input.setSelectionRange(caret, caret);
    session.input.dispatchEvent(new Event('input', { bubbles: true }));
    session.onDraft(value);
    session.writing = false;
  }

  function finish(session, { abort = false, keepEdited = false } = {}) {
    if (active !== session) return;
    active = null;
    clearTimeout(session.timeout);
    clearTimeout(session.stopTimeout);
    session.input.removeEventListener('input', session.edited);
    if (!keepEdited) write(session, session.finalText);
    else session.onDraft(session.input.value);
    updateButton(session.button, false);
    if (!session.failed) session.status.textContent = session.full ? 'Message limit reached. Review your text before sending.' : session.finalText || keepEdited ? 'Voice typing stopped. Review your text before sending.' : 'No speech was captured. Try again or type your message.';
    if (abort) { try { session.recognition.abort(); } catch { /* Already stopped. */ } }
  }

  function requestStop(session) {
    if (active !== session || session.stopping) return;
    session.stopping = true;
    session.status.textContent = 'Finishing voice typing…';
    // stop() lets the browser deliver its last finalized result before onend.
    session.stopTimeout = setTimeout(() => finish(session, { abort: true }), 3000);
    try { session.recognition.stop(); } catch { finish(session, { abort: true }); }
  }

  function start(config, language) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!config.input.isConnected || !config.canStart()) return;
    let recognition;
    try { recognition = new Recognition(); } catch { config.onError('Voice typing could not start. You can keep typing.'); return; }
    const input = config.input;
    const session = { ...config, recognition, original: input.value, before: input.value.slice(0, input.selectionStart ?? input.value.length), after: input.value.slice(input.selectionEnd ?? input.value.length), finalText: '', writing: false, stopping: false, failed: false, full: false };
    active = session;
    recognition.lang = language.code;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    updateButton(session.button, true);
    session.status.textContent = 'Starting voice typing. Allow microphone access if asked.';
    session.edited = () => { if (!session.writing) finish(session, { abort: true, keepEdited: true }); };
    input.addEventListener('input', session.edited);
    recognition.onstart = () => {
      if (active !== session) { try { recognition.abort(); } catch {} return; }
      session.status.textContent = `Listening in ${language.name}… Speak, then choose Stop.`;
    };
    recognition.onresult = event => {
      if (active !== session || !input.isConnected) return;
      const finals = [], interim = [];
      // results contains the full session; rebuilding avoids repeated interim/final words.
      for (const result of Array.from(event.results)) {
        const text = String(result[0]?.transcript || '').trim();
        if (text) (result.isFinal ? finals : interim).push(text);
      }
      session.finalText = finals.join(' ');
      write(session, [...finals, ...interim].join(' '));
      if (session.full) requestStop(session);
    };
    recognition.onerror = event => {
      if (active !== session) return;
      const messages = {
        'not-allowed': 'Microphone access was blocked. Allow it in your browser, or type your message.',
        'service-not-allowed': 'Voice typing is unavailable in this browser. You can type your message instead.',
        'audio-capture': 'No microphone was found. Check your microphone or type your message.',
        'network': 'Voice typing could not connect. Check your connection or type your message.',
        'no-speech': 'No speech was detected. Try again or type your message.',
        'language-not-supported': `${language.name} voice typing is not available in this browser. Choose another language or type your message.`,
      };
      session.failed = true;
      const message = messages[event.error] || 'Voice typing stopped. You can try again or keep typing.';
      session.status.textContent = message;
      session.onError(message);
      finish(session, { abort: true });
    };
    recognition.onend = () => finish(session);
    session.timeout = setTimeout(() => requestStop(session), 60000);
    try { recognition.start(); } catch {
      session.failed = true;
      session.status.textContent = 'Voice typing could not start. You can keep typing.';
      session.onError(session.status.textContent);
      finish(session, { abort: true });
    }
  }

  function choose(config) {
    if (chooser || !config.canStart()) return;
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition) || window.isSecureContext === false) {
      config.onError('Voice typing is not supported in this browser or connection. You can keep typing.');
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'voice-dialog';
    dialog.setAttribute('aria-labelledby', 'voice-language-title');
    dialog.innerHTML = '<div class="voice-dialog-content"><h2 id="voice-language-title">Which language will you speak?</h2><p>Choose a language to start voice typing.</p><div class="voice-language-options"></div><small>Your browser may process speech online. Review the text before sending.</small><button type="button" class="text-button voice-cancel">Cancel</button></div>';
    let selected = false;
    chooser = dialog;
    for (const language of languages) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'voice-language';
      button.dataset.language = language.code;
      button.setAttribute('aria-label', language.name);
      button.innerHTML = `<strong lang="${language.tag}">${language.native}</strong><span>${language.name}</span>`;
      button.onclick = () => { selected = true; dialog.close(); start(config, language); };
      dialog.querySelector('.voice-language-options').append(button);
    }
    dialog.querySelector('.voice-cancel').onclick = () => dialog.close();
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => {
      if (chooser === dialog) chooser = null;
      dialog.remove();
      if (!selected && config.button.isConnected) config.button.focus({ preventScroll: true });
    });
    document.body.append(dialog);
    try { dialog.showModal(); } catch {
      chooser = null; dialog.remove();
      config.onError('Voice typing could not open. You can keep typing.');
    }
  }

  function stop() { if (active) finish(active, { abort: true }); }
  function reset() {
    stop();
    if (chooser) { const dialog = chooser; chooser = null; dialog.close(); dialog.remove(); }
  }
  window.DhanaviVoice = {
    stop, reset,
    isBusy: () => !!(active || chooser),
    attach({ form, input, onDraft = () => {}, onError = () => {}, canStart = () => true }) {
      if (form.dataset.voiceAttached) return;
      form.dataset.voiceAttached = 'true';
      const submit = form.querySelector('button[type="submit"]');
      const actions = document.createElement('div'); actions.className = 'compose-actions';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'voice-button';
      updateButton(button, false);
      actions.append(button);
      if (submit) actions.append(submit);
      form.append(actions);
      const status = document.createElement('div'); status.className = 'voice-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      form.after(status);
      button.onclick = () => {
        if (active?.input === input) requestStop(active);
        else choose({ form, input, button, status, onDraft, onError, canStart });
      };
      // Finalize the draft before the app's submit handler reads the textarea.
      form.addEventListener('submit', stop, true);
    },
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  window.addEventListener('pagehide', reset);
})();
