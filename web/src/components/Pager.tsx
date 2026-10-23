import { useRef, useState, type ReactNode } from 'react'

/** Full-width pages you swipe between, with a dot row. Native scroll-snap does the swiping. */
export function Pager({ pages, labels }: { pages: ReactNode[]; labels: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const onScroll = () => {
    const el = ref.current
    if (el && el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  const go = (i: number) => {
    const el = ref.current
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={ref} onScroll={onScroll} className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pages.map((page, i) => (
          <section key={labels[i]} aria-label={labels[i]} className="h-full w-full shrink-0 snap-start overflow-y-auto overflow-x-hidden px-3">
            {page}
          </section>
        ))}
      </div>
      <nav className="flex items-center justify-center gap-4 py-2 font-mono text-[9px] uppercase" aria-label="Pages">
        {labels.map((label, i) => (
          <button key={label} type="button" onClick={() => go(i)} aria-current={i === index ? 'page' : undefined} className={i === index ? 'text-primary' : 'text-muted-foreground'}>
            <span className={`mr-1 inline-block h-1.5 w-1.5 align-middle ${i === index ? 'bg-primary shadow-signal' : 'bg-muted-foreground/40'}`} />{label}
          </button>
        ))}
      </nav>
    </div>
  )
}
