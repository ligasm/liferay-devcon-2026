package com.example.edgepurge;

import com.liferay.blogs.model.BlogsEntry;
import com.liferay.journal.model.JournalArticle;
import com.liferay.portal.kernel.exception.ModelListenerException;
import com.liferay.portal.kernel.log.Log;
import com.liferay.portal.kernel.log.LogFactoryUtil;
import com.liferay.portal.kernel.model.BaseModelListener;
import com.liferay.portal.kernel.model.Layout;
import com.liferay.portal.kernel.model.ModelListener;
import com.liferay.portal.kernel.transaction.TransactionCommitCallbackUtil;
import com.liferay.portal.kernel.workflow.WorkflowConstants;

import java.util.LinkedHashSet;
import java.util.Set;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

/**
 * S5 — purge the edge by surrogate key when content is published.
 *
 * SKETCH, not a drop-in module: it shows the three things that matter.
 *   1. One listener per entity type (register three components, or one class per
 *      model — a ModelListener is typed).
 *   2. Fire AFTER COMMIT (TransactionCommitCallbackUtil), never inside
 *      onAfterUpdate itself: the transaction can still roll back, and the edge
 *      would re-fetch the OLD content and cache it again for a full TTL.
 *   3. Purge by TAG, not by URL: an article is rendered on N pages (Asset
 *      Publisher, home, category pages…) and you do not know which. The page
 *      response must therefore carry the tags (see CacheTagFilter).
 *
 * Tag scheme (must match CacheTagFilter):
 *   site-<groupId>          every page of the site (cheap "nuke the site" key)
 *   layout-<plid>           one page
 *   article-<resourcePrimKey>  a web content article, wherever it is rendered
 *   blog-<entryId>
 *
 * Versioning caveat: JournalArticle is versioned; onAfterUpdate fires for
 * drafts, expirations and approvals. Only purge when the new version is
 * APPROVED, and use resourcePrimKey (stable across versions), not id.
 */
@Component(service = ModelListener.class)
public class EdgePurgeModelListener extends BaseModelListener<JournalArticle> {

	@Override
	public void onAfterUpdate(JournalArticle original, JournalArticle article)
		throws ModelListenerException {

		if (article.getStatus() != WorkflowConstants.STATUS_APPROVED) {
			return; // drafts / scheduled / expired: nothing is visible to guests yet
		}
		Set<String> tags = new LinkedHashSet<>();
		tags.add("article-" + article.getResourcePrimKey());
		tags.add("site-" + article.getGroupId()); // OPTIONAL: comment out to purge only pages that carry the article tag
		purgeAfterCommit(tags);
	}

	@Override
	public void onAfterRemove(JournalArticle article) throws ModelListenerException {
		purgeAfterCommit(Set.of("article-" + article.getResourcePrimKey()));
	}

	private void purgeAfterCommit(Set<String> tags) {
		// Runs once the surrounding transaction has committed; if it rolls back the
		// callback is dropped. Registering outside a transaction runs it immediately.
		TransactionCommitCallbackUtil.registerCallback(() -> {
			try {
				_edgePurger.softPurgeByTags(tags);
			}
			catch (Exception e) {
				_log.error("Edge purge failed for " + tags + " — content stays stale until TTL", e);
			}
			return null;
		});
	}

	private static final Log _log = LogFactoryUtil.getLog(EdgePurgeModelListener.class);

	@Reference
	private EdgePurger _edgePurger;
}

/*
 * The same idea for the other two entities (separate @Component classes):
 *
 * @Component(service = ModelListener.class)
 * public class LayoutEdgePurgeModelListener extends BaseModelListener<Layout> {
 *     public void onAfterUpdate(Layout original, Layout layout) {
 *         // Layout.isPublished() / getPublishDate() distinguish a page-editor
 *         // draft save from a real publish (draft layouts have a separate plid
 *         // via LayoutClassNameId in 7.4 — check before purging on every keystroke).
 *         purgeAfterCommit(Set.of("layout-" + layout.getPlid()));
 *     }
 * }
 *
 * @Component(service = ModelListener.class)
 * public class BlogsEdgePurgeModelListener extends BaseModelListener<BlogsEntry> {
 *     public void onAfterUpdate(BlogsEntry original, BlogsEntry entry) {
 *         if (entry.getStatus() != WorkflowConstants.STATUS_APPROVED) return;
 *         purgeAfterCommit(Set.of("blog-" + entry.getEntryId(), "site-" + entry.getGroupId()));
 *     }
 * }
 */
