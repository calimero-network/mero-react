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
    w.__TAURI_INTERNALS__ = {};
    expect(isDesktopWindow()).toBe(true);
  });

  it("is true when the desktop's app-window script ran", () => {
    w.__TAURI_FETCH_PROXY_INJECTED__ = true;
    expect(isDesktopWindow()).toBe(true);
  });
});
