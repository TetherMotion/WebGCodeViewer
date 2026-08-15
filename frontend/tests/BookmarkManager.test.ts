import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BookmarkManager } from '../src/ui/BookmarkManager';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('BookmarkManager', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('toggles bookmarks on and off', () => {
    const bm = new BookmarkManager('test.gcode');
    expect(bm.isBookmarked(10)).to.equal(false);
    const added = bm.toggleBookmark(10);
    expect(added).to.equal(true);
    expect(bm.isBookmarked(10)).to.equal(true);
    const removed = bm.toggleBookmark(10);
    expect(removed).to.equal(false);
    expect(bm.isBookmarked(10)).to.equal(false);
  });

  it('persists bookmarks to localStorage', () => {
    const bm1 = new BookmarkManager('persist-test.gcode');
    bm1.toggleBookmark(5);
    bm1.toggleBookmark(15);
    // Create a new instance — should load from localStorage
    const bm2 = new BookmarkManager('persist-test.gcode');
    expect(bm2.isBookmarked(5)).to.equal(true);
    expect(bm2.isBookmarked(15)).to.equal(true);
    expect(bm2.getBookmarks()).to.have.length(2);
  });

  it('navigates to next and previous bookmarks', () => {
    const bm = new BookmarkManager('nav-test.gcode');
    bm.toggleBookmark(10);
    bm.toggleBookmark(20);
    bm.toggleBookmark(30);
    expect(bm.getNextBookmark(5)).to.equal(10);
    expect(bm.getNextBookmark(10)).to.equal(20);
    expect(bm.getNextBookmark(30)).to.equal(10); // wraps around
    expect(bm.getPrevBookmark(25)).to.equal(20);
    expect(bm.getPrevBookmark(10)).to.equal(30); // wraps around
  });

  it('returns null when no bookmarks exist', () => {
    const bm = new BookmarkManager('empty.gcode');
    expect(bm.getNextBookmark(5)).to.equal(null);
    expect(bm.getPrevBookmark(5)).to.equal(null);
  });

  it('sets and gets annotations', () => {
    const bm = new BookmarkManager('annot-test.gcode');
    bm.setAnnotation(42, 'Check this layer');
    expect(bm.getAnnotation(42)).to.equal('Check this layer');
    expect(bm.hasAnnotation(42)).to.equal(true);
    expect(bm.hasAnnotation(43)).to.equal(false);
  });

  it('updates existing annotations', () => {
    const bm = new BookmarkManager('update-test.gcode');
    bm.setAnnotation(10, 'First note');
    bm.setAnnotation(10, 'Updated note');
    expect(bm.getAnnotation(10)).to.equal('Updated note');
  });

  it('removes annotations', () => {
    const bm = new BookmarkManager('remove-test.gcode');
    bm.setAnnotation(10, 'Note');
    bm.removeAnnotation(10);
    expect(bm.getAnnotation(10)).to.equal(null);
    expect(bm.hasAnnotation(10)).to.equal(false);
  });

  it('clears all bookmarks', () => {
    const bm = new BookmarkManager('clear-test.gcode');
    bm.toggleBookmark(1);
    bm.toggleBookmark(2);
    bm.toggleBookmark(3);
    bm.clearBookmarks();
    expect(bm.getBookmarks()).to.have.length(0);
  });

  it('persists annotations across instances', () => {
    const bm1 = new BookmarkManager('persist-annot.gcode');
    bm1.setAnnotation(100, 'Important line');
    const bm2 = new BookmarkManager('persist-annot.gcode');
    expect(bm2.getAnnotation(100)).to.equal('Important line');
  });
});
