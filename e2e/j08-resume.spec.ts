// J8 — Resume work across sessions/books; multi-book navigation
// JOURNEYS-AND-GAPS §2 J8 · PRD FR-29, FR-34 · TEST-PLAN E-J8 · Increment 3
import { test } from '@playwright/test';

test.describe('J8 — a translator resumes where they left off', () => {
  test.fixme(
    'after a restart, all projects are listed and the last position (project/book/chapter/mode) is restored (FR-29)',
    { tag: ['@inc3', '@J8'] },
    async () => {},
  );
  test.fixme(
    'commits happen at exactly the checkpoints — session close, mode switch, before branch ops, before export/import (FR-34 / W-4)',
    { tag: ['@inc3', '@J8'] },
    async () => {},
  );
  test.fixme(
    'typing never produces a commit (FR-34)',
    { tag: ['@inc3', '@J8'] },
    async () => {},
  );
});
