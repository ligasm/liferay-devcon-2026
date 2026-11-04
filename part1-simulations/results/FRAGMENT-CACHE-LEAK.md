# Does a Cacheable fragment leak one user's data to another?

**Yes.** Reproduced on the lab Liferay (DXP 2026.q1.12-lts) on 2026-11-03. The first viewer's name and email were shown to other signed-in users and to anonymous visitors.

To repeat it: `python3 -I part1-simulations/fragment-leak-test.py`. Raw output: `fragment-leak-test.json`.

## The test

A throwaway site held two fragments with the same code, printing the current user's name and email, on the same page:

```
[#assign u = themeDisplay.getUser()]${u.getFullName()}|${u.getEmailAddress()}
```

- `leak-cached` had the Cacheable flag on. `leak-uncached` had it off, as a control that shows who was really viewing.
- Two users and a guest each had their own session, and requests went straight to Liferay on `:8086`, with no Varnish.
- Each of three pages was opened in a different order, so each page had a different first viewer.

## Results

Each cell shows the user the fragment printed.

**Alice opens the page first**

| Viewer | Cacheable fragment | Control |
|---|---|---|
| Alice | Alice | Alice |
| Bob | **Alice** | Bob |
| Guest | **Alice** | Guest |

**Bob opens the page first**

| Viewer | Cacheable fragment | Control |
|---|---|---|
| Bob | Bob | Bob |
| Alice | **Bob** | Alice |
| Guest | **Bob** | Guest |

**A guest opens the page first**

| Viewer | Cacheable fragment | Control |
|---|---|---|
| Guest | Guest | Guest |
| Alice | **Guest** | Alice |
| Bob | **Guest** | Bob |

Whoever opened the page first decided what everyone after them saw, including when Alice and Bob returned to the page. The control was correct in all 14 views.

## What this does and doesn't show

- The fragment was written to print user data. A search of the Proventeq fragments' source found nothing that reads the current user, so this is the risk of ticking the box on the wrong fragment, not a leak in the measured site.
- Only the fragment flag was tested. The Web Content template Cacheable flag was not.
- Cache expiry and cluster behaviour were not tested.

## Changes to the lab during the test

The new-user steps needed changes, and the test undoes them:

- The instance setting `company.security.strangers.verify` was turned off while the test ran, because the lab has no mail server to verify email addresses. The override was then removed, and a test user was again sent to the Verify Email Address page.
- The site, fragments, pages and test users are deleted at the end.
