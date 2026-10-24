// What "changed" means per content kind. Only these fields feed the content
// hash, so a comment counter ticking up does NOT trigger a rebuild.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { sha256, slugify } from './util.mjs';

export const KINDS = ['blog', 'page', 'nav', 'document', 'structured'];

export const rawDir = (kind) => path.join(config.dirs.raw, kind);
export const rawFile = (kind, id) => path.join(rawDir(kind), `${id}.json`);
export const renderedFile = (id) => path.join(rawDir('page'), `${id}.html`);

export function significant(kind, item) {
  switch (kind) {
    case 'blog':
      return {
        headline: item.headline, alternativeHeadline: item.alternativeHeadline, description: item.description,
        articleBody: item.articleBody, friendlyUrlPath: item.friendlyUrlPath, datePublished: item.datePublished,
        creator: item.creator?.name, image: item.image?.contentUrl,
        categories: (item.taxonomyCategoryBriefs ?? []).map((c) => c.taxonomyCategoryName), keywords: item.keywords,
      };
    case 'page': {
      const html = fs.existsSync(renderedFile(item.id)) ? fs.readFileSync(renderedFile(item.id), 'utf8') : '';
      return { title: item.title, friendlyUrlPath: item.friendlyUrlPath, dateModified: item.dateModified,
        master: item.renderedPage?.masterPageId, htmlHash: sha256(html) };
    }
    case 'nav':
      return { name: item.name, items: stripNav(item.navigationMenuItems) };
    case 'document':
      return { title: item.title, description: item.description, contentUrl: item.contentUrl,
        adaptedImages: item.adaptedImages, fileExtension: item.fileExtension, sizeInBytes: item.sizeInBytes };
    case 'structured':
      return { title: item.title, description: item.description, friendlyUrlPath: item.friendlyUrlPath,
        contentStructureId: item.contentStructureId, contentFields: item.contentFields, dateModified: item.dateModified };
    default:
      return item;
  }
}
const stripNav = (items = []) => items.map((i) => ({ name: i.name, type: i.type, typeSettings: i.typeSettings, children: stripNav(i.navigationMenuItems) }));

export const contentHash = (kind, item) => sha256(JSON.stringify(significant(kind, item)));

// Public URL of an item on the static site (used for purge lists and links).
export function publicPath(kind, item) {
  switch (kind) {
    case 'blog': return `/blog/${slugify(item.friendlyUrlPath || item.id)}/`;
    case 'page': return item.friendlyUrlPath === config.homePagePath ? '/' : `/${slugify(item.friendlyUrlPath.replace(/^\//, ''))}/`;
    case 'document': return `/documents/`;
    case 'nav': return `/`;
    case 'structured': return `/content/${slugify(item.friendlyUrlPath || item.id)}/`;
    default: return '/';
  }
}

// Fields the model may fill in for a blog post when the editor left them empty.
export function missingFields(rawBlog) {
  const missing = [];
  if (!rawBlog.description?.trim()) missing.push('description');
  if (!rawBlog.alternativeHeadline?.trim()) missing.push('seoTitle');
  if (!(rawBlog.taxonomyCategoryBriefs ?? []).length) missing.push('suggestedCategory');
  return missing;
}

// Read every raw item of a kind from disk.
export function loadRaw(kind) {
  const dir = rawDir(kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
