/** Render real model updates without replacing the response on every token. */
export class ResponseView {
  constructor(element, container) {
    this.element = element;
    this.container = container;
    this.document = element.ownerDocument;
    this.text = '';
    this.follow = true;
    this.onScroll = () => { this.follow = this.atBottom(); };
    container.addEventListener('scroll', this.onScroll, { passive: true });
    // Resizing does not fire scroll events; keep the latest line in view.
    new ResizeObserver(() => {
      if (this.follow) container.scrollTop = container.scrollHeight;
    }).observe(container);
  }

  atBottom() {
    return this.container.scrollHeight - this.container.clientHeight - this.container.scrollTop < 28;
  }

  update(render) {
    const follow = this.follow || this.atBottom();
    const position = this.container.scrollTop;
    render();
    this.container.scrollTop = follow ? this.container.scrollHeight : position;
    this.follow = follow;
  }

  begin() {
    this.text = '';
    this.follow = true;
    this.element.replaceChildren();
    this.element.classList.add('active', 'response-streaming');
    this.container.classList.add('is-streaming');
    this.container.scrollTop = 0;
  }

  append(fullText) {
    const next = String(fullText ?? '');
    if (next === this.text) return;
    this.update(() => {
      let common = 0;
      const limit = Math.min(this.text.length, next.length);
      while (common < limit && this.text[common] === next[common]) common += 1;
      // A tokenizer can replace a partial UTF-8 character on its next update.
      // Preserve the stable text while allowing that final fragment to change.
      if (common && /[\uD800-\uDBFF]/.test(next[common - 1])) common -= 1;
      if (common < this.text.length) this.truncate(common);
      const addition = next.slice(common);
      if (addition) {
        const span = this.document.createElement('span');
        span.className = 'response-stream-segment';
        span.textContent = addition;
        this.element.append(span);
      }
      this.text = next;
    });
  }

  truncate(length) {
    let remaining = length;
    for (const child of [...this.element.childNodes]) {
      const size = child.textContent.length;
      if (remaining >= size) {
        remaining -= size;
      } else if (remaining > 0) {
        child.textContent = child.textContent.slice(0, remaining);
        remaining = 0;
      } else {
        child.remove();
      }
    }
  }

  appendInline(parent, text) {
    // Support a small, safe Markdown subset. Model text never becomes HTML.
    let position = 0;
    for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
      parent.append(this.document.createTextNode(text.slice(position, match.index)));
      const strong = this.document.createElement('strong');
      strong.textContent = match[1];
      parent.append(strong);
      position = match.index + match[0].length;
    }
    parent.append(this.document.createTextNode(text.slice(position)));
  }

  finish(fullText) {
    this.update(() => {
      this.text = String(fullText ?? '');
      const fragment = this.document.createDocumentFragment();
      for (const text of this.text.split('\n')) {
        const line = this.document.createElement('span');
        line.className = 'response-line';
        const bullet = text.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
        if (bullet) {
          line.classList.add('response-list-item');
          const marker = this.document.createElement('span');
          marker.className = 'response-list-marker';
          marker.textContent = `${bullet[1]}${bullet[2]} `;
          line.append(marker);
          this.appendInline(line, bullet[3]);
        } else {
          this.appendInline(line, text);
        }
        if (/^\s*(?:\*\*)?ACTION\s*:/i.test(text)) line.classList.add('response-action-line');
        fragment.append(line);
      }
      this.element.replaceChildren(fragment);
      this.stopStreaming();
    });
  }

  reset(text) {
    this.text = String(text ?? '');
    this.follow = true;
    this.element.textContent = this.text;
    this.element.classList.remove('active');
    this.stopStreaming();
    this.container.scrollTop = 0;
  }

  stopStreaming() {
    this.element.classList.remove('response-streaming');
    this.container.classList.remove('is-streaming');
  }
}
