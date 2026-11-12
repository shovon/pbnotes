// On narrow screens the nav shows a "Socials" link to socials.html. With JavaScript,
// turn it into a button that drops down the footer's social links instead.
{
  const link = document.querySelector('nav .socials');
  const icons = document.querySelector('footer .social');
  if (link && icons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = link.className;
    button.textContent = link.textContent;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'socials-menu');

    const menu = icons.cloneNode(true);
    menu.id = 'socials-menu';
    menu.className = 'socials-menu';
    menu.hidden = true;
    menu.querySelectorAll('a').forEach(a => { a.append(a.title); a.removeAttribute('title'); });

    link.replaceWith(button);
    button.after(menu);

    const show = open => { menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
    button.addEventListener('click', () => show(menu.hidden));
    document.addEventListener('click', e => { if (!button.contains(e.target) && !menu.contains(e.target)) show(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { show(false); button.focus(); } });
  }
}
