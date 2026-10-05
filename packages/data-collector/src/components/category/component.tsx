// Consent card for one category: a summary with example entries, a switch to leave the
// whole category out, and an optional inspector to page through, search and delete
// individual entries. Rows are fetched from the worker a page at a time; the card reports
// only the participant's choices ({included, deleted row ids}) to the page.

import React, { useEffect, useState } from 'react'
import type { ReactFactoryContext } from '@eyra/feldspar'
import { useRowSource } from './row_source'
import { translate, type Cell, type PropsUIPromptCategory, type RowView } from './types'
import './category.css'

type Context = ReactFactoryContext & { onDataSubmissionDataChanged?: (key: string, value: unknown) => void }
type Props = PropsUIPromptCategory & Context

const PAGE_SIZE = 50

const TEXT: Record<string, Record<string, string>> = {
  en: {
    summary: '{count} entries between {from} and {to}',
    summaryNoDates: '{count} entries',
    empty: 'Nothing of this kind was found in your file.',
    examples: 'Examples',
    include: 'Include in my donation',
    excluded: 'This data will not be donated.',
    inspect: 'Look through all entries',
    hide: 'Hide entries',
    search: 'Search',
    shown: 'Entries {first}–{last} of {total}',
    none: 'No matching entries',
    previous: 'Previous',
    next: 'Next',
    deleteSelected: 'Delete selected ({n})',
    deleted: 'Deleted',
    restore: 'Restore',
    deletedCount: '{n} entries deleted',
    restoreAll: 'Restore all',
    loading: 'Loading…',
    failed: 'Could not load entries.'
  },
  nl: {
    summary: '{count} regels tussen {from} en {to}',
    summaryNoDates: '{count} regels',
    empty: 'Niets van deze soort gevonden in je bestand.',
    examples: 'Voorbeelden',
    include: 'Opnemen in mijn donatie',
    excluded: 'Deze gegevens worden niet gedoneerd.',
    inspect: 'Alle regels bekijken',
    hide: 'Regels verbergen',
    search: 'Zoeken',
    shown: 'Regels {first}–{last} van {total}',
    none: 'Geen overeenkomende regels',
    previous: 'Vorige',
    next: 'Volgende',
    deleteSelected: 'Geselecteerde verwijderen ({n})',
    deleted: 'Verwijderd',
    restore: 'Herstellen',
    deletedCount: '{n} regels verwijderd',
    restoreAll: 'Alles herstellen',
    loading: 'Laden…',
    failed: 'Regels konden niet worden geladen.'
  }
}

function fill (template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

export const CategoryCard: React.FC<Props> = (props) => {
  const { id, title, description, summary, columns, headers, rowCount, dateRange, examples, channel, locale } = props
  const text = (key: string, values: Record<string, string> = {}): string => fill((TEXT[locale] ?? TEXT.en)[key], values)
  const number = (n: number): string => n.toLocaleString(locale)

  const [included, setIncluded] = useState(true)
  const [deleted, setDeleted] = useState<Set<number>>(new Set())
  const [inspecting, setInspecting] = useState(false)

  useEffect(() => {
    props.onDataSubmissionDataChanged?.(id, { included, deleted: [...deleted] })
  }, [id, included, deleted])

  const toggleDeleted = (ids: number[], remove: boolean): void => {
    setDeleted((previous) => {
      const next = new Set(previous)
      for (const rowId of ids) remove ? next.add(rowId) : next.delete(rowId)
      return next
    })
  }

  const values = { count: number(rowCount), from: dateRange?.from ?? '', to: dateRange?.to ?? '' }
  const summaryLine = summary !== undefined && (dateRange !== null || !summary.translations.en?.includes('{from}'))
    ? fill(translate(summary, locale), values)
    : text(dateRange !== null ? 'summary' : 'summaryNoDates', values)
  const labels = columns.map((column) => (headers?.[column] !== undefined ? translate(headers[column], locale) : column))

  return (
    <section className={`category ${included ? '' : 'category--excluded'}`} data-testid={`category-${id}`}>
      <h3 className='category__title'>{translate(title, locale)}</h3>
      {description !== undefined && <p className='category__description'>{translate(description, locale)}</p>}

      {rowCount === 0
        ? <p className='category__summary'>{text('empty')}</p>
        : (
          <>
            <p className='category__summary'>{summaryLine}</p>
            <label className='category__include'>
              <input type='checkbox' checked={included} onChange={(e) => setIncluded(e.target.checked)} />
              {text('include')}
            </label>
            {!included && <p className='category__note'>{text('excluded')}</p>}
            {included && (
              <>
                <div className='category__label'>{text('examples')}</div>
                <RowTable labels={labels} rows={examples} deleted={deleted} />
                <button type='button' className='category__link' onClick={() => setInspecting(!inspecting)}>
                  {text(inspecting ? 'hide' : 'inspect')}
                </button>
                {inspecting && (
                  <Inspector id={id} channel={channel} labels={labels} deleted={deleted} onDelete={toggleDeleted} text={text} number={number} />
                )}
                {deleted.size > 0 && (
                  <p className='category__note'>
                    {text('deletedCount', { n: number(deleted.size) })}{' '}
                    <button type='button' className='category__link' onClick={() => setDeleted(new Set())}>{text('restoreAll')}</button>
                  </p>
                )}
              </>
            )}
          </>
          )}
    </section>
  )
}

const display = (cell: Cell): string => (cell === null ? '' : String(cell))

const RowTable: React.FC<{
  labels: string[]
  rows: RowView[]
  deleted: Set<number>
  selection?: { selected: Set<number>, toggle: (id: number) => void, restore: (id: number) => void, deletedLabel: string, restoreLabel: string }
}> = ({ labels, rows, deleted, selection }) => (
  <div className='category__table-wrap'>
    <table className='category__table'>
      <thead>
        <tr>
          {selection !== undefined && <th />}
          {labels.map((label) => <th key={label}>{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isDeleted = deleted.has(row.id)
          return (
            <tr key={row.id} className={isDeleted ? 'category__row--deleted' : ''}>
              {selection !== undefined && (
                <td className='category__select'>
                  {isDeleted
                    ? <button type='button' className='category__link' onClick={() => selection.restore(row.id)} title={selection.deletedLabel}>{selection.restoreLabel}</button>
                    : <input type='checkbox' checked={selection.selected.has(row.id)} onChange={() => selection.toggle(row.id)} />}
                </td>
              )}
              {row.cells.map((cell, c) => <td key={c} title={display(cell)}>{display(cell)}</td>)}
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)

const Inspector: React.FC<{
  id: string
  channel: string
  labels: string[]
  deleted: Set<number>
  onDelete: (ids: number[], remove: boolean) => void
  text: (key: string, values?: Record<string, string>) => string
  number: (n: number) => string
}> = ({ id, channel, labels, deleted, onDelete, text, number }) => {
  const fetchRows = useRowSource(channel)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<{ total: number, rows: RowView[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Search after typing pauses, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setOffset(0) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let current = true
    fetchRows(id, offset, PAGE_SIZE, query).then(
      (result) => { if (current) { setPage(result); setFailed(false) } },
      () => { if (current) setFailed(true) }
    )
    return () => { current = false }
  }, [id, offset, query])

  const toggle = (rowId: number): void => setSelected((previous) => {
    const next = new Set(previous)
    next.has(rowId) ? next.delete(rowId) : next.add(rowId)
    return next
  })

  return (
    <div className='category__inspector'>
      <input type='search' className='category__search' placeholder={text('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      {failed && <p className='category__note'>{text('failed')}</p>}
      {page === null && !failed && <p className='category__note'>{text('loading')}</p>}
      {page !== null && (page.total === 0
        ? <p className='category__note'>{text('none')}</p>
        : (
          <>
            <RowTable
              labels={labels}
              rows={page.rows}
              deleted={deleted}
              selection={{ selected, toggle, restore: (rowId) => onDelete([rowId], false), deletedLabel: text('deleted'), restoreLabel: text('restore') }}
            />
            <div className='category__pager'>
              <button type='button' disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{text('previous')}</button>
              <span>{text('shown', { first: number(offset + 1), last: number(Math.min(offset + PAGE_SIZE, page.total)), total: number(page.total) })}</span>
              <button type='button' disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>{text('next')}</button>
              <button
                type='button'
                className='category__delete'
                disabled={selected.size === 0}
                onClick={() => { onDelete([...selected], true); setSelected(new Set()) }}
              >
                {text('deleteSelected', { n: number(selected.size) })}
              </button>
            </div>
          </>
          ))}
    </div>
  )
}
