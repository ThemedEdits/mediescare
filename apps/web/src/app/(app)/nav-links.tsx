'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** True when `pathname` is the page `href` or one of its sub-pages ("/" only matches itself). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Top menu. The open page is highlighted and underlined, and announced with aria-current. */
export function NavLinks({
  items,
  label,
}: {
  items: { href: string; text: string }[];
  label: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1">
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`relative rounded-[6px] px-3 py-2 text-sm font-medium ${
              active
                ? 'bg-primary-50 text-primary-700 after:absolute after:inset-x-2 after:-bottom-[9px] after:h-[3px] after:rounded-full after:bg-primary-600'
                : 'text-slate-700 hover:bg-primary-50 hover:text-primary-600'
            }`}
          >
            {item.text}
          </Link>
        );
      })}
    </nav>
  );
}
