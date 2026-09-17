import { vi } from 'vitest';

// jsdom 未实现滚动 API，Vue Router 的 scrollBehavior 会调用它
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
