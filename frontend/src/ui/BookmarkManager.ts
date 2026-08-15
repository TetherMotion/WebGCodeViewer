/**
 * @file BookmarkManager.ts
 * @brief Manages G-code line bookmarks and user annotations.
 * Bookmarks are line numbers the user marks for quick navigation.
 * Annotations are text notes attached to specific line numbers.
 * Both are persisted to localStorage per filename.
 */

export interface Bookmark {
  lineNumber: number;
  label: string;       // optional user label
  createdAt: number;   // timestamp
}

export interface Annotation {
  lineNumber: number;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export class BookmarkManager {
  private bookmarks: Map<number, Bookmark> = new Map();
  private annotations: Map<number, Annotation> = new Map();
  private storageKey: string;

  constructor(filename: string) {
    this.storageKey = `wgv-bookmarks-${filename}`;
    this.load();
  }

  /**
   * Load bookmarks and annotations from localStorage.
   */
  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.bookmarks) {
        for (const b of data.bookmarks) {
          this.bookmarks.set(b.lineNumber, b);
        }
      }
      if (data.annotations) {
        for (const a of data.annotations) {
          this.annotations.set(a.lineNumber, a);
        }
      }
    } catch {
      // localStorage might not be available or data is corrupt
    }
  }

  /**
   * Save bookmarks and annotations to localStorage.
   */
  private save(): void {
    try {
      const data = {
        bookmarks: Array.from(this.bookmarks.values()),
        annotations: Array.from(this.annotations.values()),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // ignore storage errors
    }
  }

  // ── Bookmarks ──

  toggleBookmark(lineNumber: number, label: string = ''): boolean {
    if (this.bookmarks.has(lineNumber)) {
      this.bookmarks.delete(lineNumber);
      this.save();
      return false; // removed
    }
    this.bookmarks.set(lineNumber, {
      lineNumber,
      label,
      createdAt: Date.now(),
    });
    this.save();
    return true; // added
  }

  isBookmarked(lineNumber: number): boolean {
    return this.bookmarks.has(lineNumber);
  }

  getBookmarks(): Bookmark[] {
    return Array.from(this.bookmarks.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  }

  getNextBookmark(lineNumber: number): number | null {
    const sorted = this.getBookmarks();
    for (const b of sorted) {
      if (b.lineNumber > lineNumber) return b.lineNumber;
    }
    // Wrap around
    if (sorted.length > 0) return sorted[0].lineNumber;
    return null;
  }

  getPrevBookmark(lineNumber: number): number | null {
    const sorted = this.getBookmarks();
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].lineNumber < lineNumber) return sorted[i].lineNumber;
    }
    // Wrap around
    if (sorted.length > 0) return sorted[sorted.length - 1].lineNumber;
    return null;
  }

  clearBookmarks(): void {
    this.bookmarks.clear();
    this.save();
  }

  // ── Annotations ──

  setAnnotation(lineNumber: number, text: string): void {
    const existing = this.annotations.get(lineNumber);
    if (existing) {
      existing.text = text;
      existing.updatedAt = Date.now();
    } else {
      this.annotations.set(lineNumber, {
        lineNumber,
        text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.save();
  }

  getAnnotation(lineNumber: number): string | null {
    return this.annotations.get(lineNumber)?.text ?? null;
  }

  removeAnnotation(lineNumber: number): void {
    this.annotations.delete(lineNumber);
    this.save();
  }

  getAnnotations(): Annotation[] {
    return Array.from(this.annotations.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  }

  hasAnnotation(lineNumber: number): boolean {
    return this.annotations.has(lineNumber);
  }
}
