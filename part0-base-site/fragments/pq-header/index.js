const header = fragmentElement.querySelector('.pq-header');
const toggle = fragmentElement.querySelector('.pq-header__toggle');

if (toggle) {
	toggle.addEventListener('click', () => {
		const open = header.classList.toggle('is-open');
		toggle.setAttribute('aria-expanded', String(open));
	});
}

const path = window.location.pathname.replace(/\/$/, '');

fragmentElement.querySelectorAll('.pq-nav a').forEach((link) => {
	const href = new URL(link.href).pathname.replace(/\/$/, '');

	if (path === href || path.startsWith(href + '/')) {
		link.classList.add('is-active');
	}
});
