(() => {
  // Parse first, then sanitize. Never insert the model's raw HTML into the page.
  window.renderAssistantMarkdown = text => {
    const html = marked.parse(String(text ?? ''), { gfm: true, breaks: true, async: false });
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p','br','strong','em','del','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','a','table','thead','tbody','tr','th','td','hr'],
      ALLOWED_ATTR: ['href','title','start'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    for (const link of clean.querySelectorAll('a')) {
      const href = link.getAttribute('href');
      try {
        const url = new URL(href || '', location.origin);
        if (!href || !['https:', 'http:'].includes(url.protocol)) throw Error('Unsupported link');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } catch { link.removeAttribute('href'); }
    }
    const container = document.createElement('div');
    container.append(clean);
    return container.innerHTML;
  };
})();
