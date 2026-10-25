// Reads the JSON the orchestrator wrote to content/build/. Astro pages never
// talk to Liferay: the build is a pure function of these files.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.env.CONTENT_DIR ? pathToFileURL(path.join(process.env.CONTENT_DIR, 'build') + path.sep) : new URL('../../../content/build/', import.meta.url);
const load = <T>(name: string, fallback: T): T => {
  const f = new URL(name, dir);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : fallback;
};

export type NavItem = { label: string; href: string; external: boolean; newTab: boolean; children: NavItem[] };
export type Post = {
  id: number; slug: string; path: string; title: string; seoTitle: string; description: string; descriptionSource: string;
  html: string; text: string; author: string; datePublished: string; dateModified: string;
  categories: { name: string; slug: string; suggested?: boolean }[]; keywords: string[]; image: string | null;
  readingMinutes: number; numberOfComments: number; portalUrl: string;
};
export type Page = { id: number; slug: string; path: string; title: string; html: string; text: string; dateModified: string; master: string | null; ruleSource: string; hidden: boolean; portalUrl: string; seoDescription: string };
export type Doc = { id: number; title: string; description: string; ext: string; size: number; dateModified: string; url: string; mime: string; thumb: string; preview: string };
export type Structured = { id: number; slug: string; path: string; title: string; description: string; dateModified: string; structureId: number; template: string; portalUrl: string; fields: { name: string; label: string; type: string; value: string; html: string | null }[] };
export type Site = { name: string; liferayUrl: string; publicUrl: string; generatedAt: string; siteMenuName: string; homeFromPage?: boolean; nav: Record<string, NavItem[]>; counts: Record<string, number> };

export const site = load<Site>('site.json', { name: 'site', liferayUrl: '', publicUrl: '', generatedAt: '', siteMenuName: 'Site Menu', nav: {}, counts: {} });
export const posts = load<Post[]>('posts.json', []);
export const pages = load<Page[]>('pages.json', []);
export const documents = load<Doc[]>('documents.json', []);
export const structured = load<Structured[]>('structured.json', []);
export const categories = load<{ name: string; slug: string; count: number }[]>('categories.json', []);

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
export const POSTS_PER_PAGE = 12;
