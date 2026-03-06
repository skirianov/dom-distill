import { vi } from 'vitest';

// Mock window.getComputedStyle for all tests
vi.stubGlobal('getComputedStyle', (element: Element) => {
  return {
    display: element.getAttribute('data-display') || 'block',
    visibility: element.getAttribute('data-visibility') || 'visible',
    opacity: element.getAttribute('data-opacity') || '1',
    cursor: element.tagName === 'BUTTON' ? 'pointer' : 'default'
  };
});

// Mock getBoundingClientRect
Element.prototype.getBoundingClientRect = function () {
  const width = parseInt(this.getAttribute('data-width') || '100', 10);
  const height = parseInt(this.getAttribute('data-height') || '50', 10);
  return {
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({})
  };
};

// Mock innerWidth/innerHeight
Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true });

// Mock CSS.escape (not available in jsdom)
if (typeof CSS === 'undefined' || !CSS.escape) {
  (globalThis as any).CSS = {
    escape: (str: string) => {
      // Simple CSS escape - escape special chars
      return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }
  };
}

