import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { question, quiz, rotation, scheduleEntry } from '../src/db/schema';
import { countChanges, importContent } from '../src/modules/content';
import { openTestDatabase, truncateAll } from './db';

const database = openTestDatabase();
const db = database.db;
const REPO_CONTENT = new URL('../../../content', import.meta.url).pathname;
let dir: string;

async function editJson(path: string, edit: (value: any) => void) {
  const file = join(dir, path);
  const value = JSON.parse(await readFile(file, 'utf8'));
  edit(value);
  await writeFile(file, JSON.stringify(value));
}

beforeEach(async () => {
  await truncateAll(db);
  dir = await mkdtemp(join(tmpdir(), 'kno-content-'));
  await cp(REPO_CONTENT, dir, { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));
afterAll(() => database.close());

describe('kno import', () => {
  it('upserts published questions and the rotation, and a second run changes nothing', async () => {
    const first = await importContent(db, dir);
    expect(first.quizzes.written).toBe(1);
    expect(first.questions.written).toBe(7);
    expect(first.rotation.written).toBe(7);

    const before = await db.select().from(question).orderBy(asc(question.slug));
    const second = await importContent(db, dir);
    expect(countChanges(second)).toBe(0);
    const after = await db.select().from(question).orderBy(asc(question.slug));
    expect(after).toEqual(before);
    expect(after.every((row) => row.status === 'published')).toBe(true);

    const [lotr] = after.filter((row) => row.slug === 'lotr-oscars');
    expect(lotr).toMatchObject({ quizSlug: 'daily-originals', category: 'Movies', correctIndex: 1 });
    expect(lotr!.content.text.en).toMatch(/Academy Awards/);
    expect((await db.select().from(rotation)).map((row) => row.anchor)).toEqual(Array(7).fill('1970-01-01'));
  });

  it('updates a changed question by slug and touches only that row', async () => {
    await importContent(db, dir);
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions[0].summary.en = 'Edited summary.';
    });
    const report = await importContent(db, dir);
    expect(report.questions.written).toBe(1);
    expect(countChanges(report)).toBe(1);
    const [row] = await db.select().from(question).where(eq(question.slug, 'earth-atmosphere'));
    expect(row!.content.summary.en).toBe('Edited summary.');
  });

  it('marks a question that goes back to pending as unpublished instead of deleting it', async () => {
    await importContent(db, dir);
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions.find((item: { slug: string }) => item.slug === 'http-meaning').status = 'pending';
    });
    await editJson('daily/schedule.json', (file) => {
      file.rotation.questions = file.rotation.questions.filter((slug: string) => slug !== 'http-meaning');
    });

    const report = await importContent(db, dir);
    expect(report.questions.unpublished).toBe(1);
    expect(report.rotation.removed).toBe(1);
    expect(report.skippedPending).toBe(1);
    const [row] = await db.select().from(question).where(eq(question.slug, 'http-meaning'));
    expect(row?.status).toBe('unpublished');
    expect(await db.select().from(rotation)).toHaveLength(6);
  });

  it('never imports pending questions or pending schedule entries', async () => {
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions.push({ ...file.questions[0], slug: 'draft-question', status: 'pending' });
    });
    await editJson('daily/schedule.json', (file) => {
      file.entries = [
        { dailyDate: '2026-12-01', question: 'largest-desert', status: 'published' },
        { dailyDate: '2026-12-02', question: 'largest-desert', status: 'pending' },
      ];
    });
    const report = await importContent(db, dir);
    expect(report.skippedPending).toBe(2);
    expect(await db.select().from(question).where(eq(question.slug, 'draft-question'))).toHaveLength(0);
    expect(await db.select().from(scheduleEntry)).toEqual([expect.objectContaining({ dailyDate: '2026-12-01', questionSlug: 'largest-desert' })]);
  });

  it('refuses a schedule naming an unpublished question and writes nothing', async () => {
    await editJson('daily/schedule.json', (file) => {
      file.rotation.questions.push('no-such-question');
    });
    await expect(importContent(db, dir)).rejects.toThrow(/no-such-question/);
    expect(await db.select().from(quiz)).toHaveLength(0);
    expect(await db.select().from(question)).toHaveLength(0);
  });

  it('reports invalid content files with the failing path', async () => {
    await editJson('quizzes/daily-originals.json', (file) => {
      file.questions[2].options.pop();
    });
    await expect(importContent(db, dir)).rejects.toThrow(/daily-originals\.json[\s\S]*questions\.2\.options/);
  });
});
