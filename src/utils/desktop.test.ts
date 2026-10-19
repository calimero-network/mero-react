// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { isDesktopWindow } from './desktop';

const w = window as unknown as Record<string, unknown>;

describe('isDesktopWindow', () => {
  afterEach(() => {
    delete w.__TAURI_INTERNALS__;
    delete w.__TAURI_FETCH_PROXY_INJECTED__;
  });

  it('is false in a plain browser', () => {
    expect(isDesktopWindow()).toBe(false);
  });

  it('is true when Tauri injected its internals', () => {
    w.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve() };
    expect(isDesktopWindow()).toBe(true);
  });

  // A browser exposes an element with this id as the global (jsdom does not), so model it.
  it('is false when only a page element carries the id', () => {
    const el = document.createElement('div');
    el.id = '__TAURI_INTERNALS__';
    document.body.append(el);
    w.__TAURI_INTERNALS__ = el;
    try {
      expect(isDesktopWindow()).toBe(false);
    } finally {
      el.remove();
    }
  });

  it('is false for internals without a callable invoke', () => {
    w.__TAURI_INTERNALS__ = { invoke: document.createElement('input') };
    expect(isDesktopWindow()).toBe(false);
  });

  it("is true when the desktop's app-window script ran", () => {
    w.__TAURI_FETCH_PROXY_INJECTED__ = true;
    expect(isDesktopWindow()).toBe(true);
  });
});
