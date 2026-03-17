import { type MetaFunction } from 'react-router'

export const meta: MetaFunction = () => [
  { title: 'Charge With Crypto | Open-source crypto checkout' },
  {
    name: 'description',
    content:
      'Open-source wallet-first crypto checkout with React Router v7 and viem.',
  },
]

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-10 sm:px-8">
      <section className="w-full max-w-5xl rounded-[2rem] border border-[color:var(--color-cwc-border)] bg-white/86 p-8 shadow-[0_24px_64px_rgba(21,21,21,0.08)] backdrop-blur sm:p-10">
        <p className="mb-3 text-[0.85rem] font-bold tracking-[0.18em] text-[color:var(--color-cwc-green-soft)] uppercase">
          Open Source Canonical
        </p>
        <h1 className="m-0 text-[clamp(2.25rem,5vw,4rem)] leading-[0.98] font-semibold tracking-[-0.04em]">
          Charge With Crypto now runs on React Router v7, viem, Drizzle, and
          Zod.
        </h1>
        <p className="mt-4 max-w-3xl text-[1.05rem] leading-7 text-[color:var(--color-cwc-muted-strong)]">
          This is the canonical open-source app: hosted checkout, merchant
          dashboard, manual pay, and API routes all live on the same React
          Router v7 runtime. The goal is a cleaner codebase and a more readable
          base repo for merchants who want to fork it.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <article className="rounded-3xl border border-[color:var(--color-cwc-border)] bg-white p-5">
            <h2 className="m-0 text-base font-semibold">Core stack</h2>
            <ul className="mt-3 pl-5 text-[color:var(--color-cwc-muted)]">
              <li>React Router v7 owns pages and API resource routes.</li>
              <li>viem owns the EVM path instead of ethers.</li>
              <li>Drizzle and Zod now back persistence and validation.</li>
            </ul>
          </article>

          <article className="rounded-3xl border border-[color:var(--color-cwc-border)] bg-white p-5">
            <h2 className="m-0 text-base font-semibold">Included flows</h2>
            <ul className="mt-3 pl-5 text-[color:var(--color-cwc-muted)]">
              <li>Hosted checkout with wallet and manual payment flows</li>
              <li>Merchant dashboard with plan and settlement controls</li>
              <li>
                Shared API routes for checkout creation, status, and payments
              </li>
            </ul>
          </article>

          <article className="rounded-3xl border border-[color:var(--color-cwc-border)] bg-white p-5">
            <h2 className="m-0 text-base font-semibold">Next work</h2>
            <p className="mt-3 leading-6 text-[color:var(--color-cwc-muted)]">
              The next refactors are code cleanup and deeper structural
              alignment with the Oasis repo, not maintaining a second legacy
              frontend.
            </p>
          </article>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            className="inline-flex min-w-52 items-center justify-center rounded-full bg-[color:var(--color-cwc-green)] px-5 py-3 font-semibold text-white no-underline transition hover:bg-[color:var(--color-cwc-green-soft)]"
            href="/dashboard"
          >
            Open dashboard
          </a>
          <a
            className="inline-flex min-w-52 items-center justify-center rounded-full bg-black/6 px-5 py-3 font-semibold no-underline transition hover:bg-black/10"
            href="/api/health"
          >
            Check API health
          </a>
        </div>
      </section>
    </main>
  )
}
