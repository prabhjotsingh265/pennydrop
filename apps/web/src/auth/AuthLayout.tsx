import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { DropLoop } from './DropLoop.tsx';

/** The form on one side; on the other, what Pennydrop does, playing on a loop. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <Link to="/" className="flex w-fit items-center gap-2">
          <BrandMark size={30} />
          <span className="text-lg font-semibold [font-stretch:112%]">Pennydrop</span>
        </Link>
        <div className="my-auto w-full max-w-sm py-12">
          <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">{title}</h1>
          <div className="mt-8">{children}</div>
        </div>
      </main>
      <aside className="hidden flex-col justify-center gap-10 border-l border-line bg-surface px-12 py-16 lg:flex">
        <p className="max-w-md text-[34px] leading-[1.1] font-semibold [font-stretch:115%]">
          Know when the penny drops.
        </p>
        <div className="max-w-xl">
          <DropLoop />
        </div>
        <p className="tabular max-w-md text-[12px] leading-5 text-ink-2">
          Every shop checked politely, every price read five ways, and history kept as the steps it
          really took.
        </p>
      </aside>
    </div>
  );
}
