// Consent card for one category: a summary with example entries, a switch to leave the
// whole category out, and an optional inspector to page through, search and delete
// individual entries. Rows are fetched from the worker a page at a time; the card reports
// only the participant's choices ({included, deleted row ids}) to the page.
//
// Accessibility: every control is a native element with a name (a row's checkbox is "Select entry
// 51"); deleted rows say so to screen readers, not only by strike-through; page changes in the
// inspector are announced. On narrow screens the tables become one stacked card per entry.

import React, { useEffect, useId, useState } from 'react'
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
    search: 'Search entries',
    shown: 'Entries {first}–{last} of {total}',
    none: 'No matching entries',
    previous: 'Previous',
    next: 'Next',
    select: 'Select',
    selectEntry: 'Select entry {n}',
    deleteSelected: 'Delete selected ({n})',
    deleted: 'deleted',
    restore: 'Restore',
    restoreEntry: 'Restore entry {n}',
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
    search: 'Regels doorzoeken',
    shown: 'Regels {first}–{last} van {total}',
    none: 'Geen overeenkomende regels',
    previous: 'Vorige',
    next: 'Volgende',
    select: 'Selecteren',
    selectEntry: 'Regel {n} selecteren',
    deleteSelected: 'Geselecteerde verwijderen ({n})',
    deleted: 'verwijderd',
    restore: 'Herstellen',
    restoreEntry: 'Regel {n} herstellen',
    deletedCount: '{n} regels verwijderd',
    restoreAll: 'Alles herstellen',
    loading: 'Laden…',
    failed: 'Regels konden niet worden geladen.'
  }
}

type Text = (key: string, values?: Record<string, string>) => string

function fill (template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

export const CategoryCard: React.FC<Props> = (props) => {
  const { id, title, description, summary, columns, headers, rowCount, dateRange, examples, channel, locale } = props
  const text: Text = (key, values = {}) => fill((TEXT[locale] ?? TEXT.en)[key], values)
  const number = (n: number): string => n.toLocaleString(locale)
  const headingId = useId()
  const inspectorId = useId()

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
    <section className={`category ${included ? '' : 'category--excluded'}`} aria-labelledby={headingId} data-testid={`category-${id}`}>
      <h2 id={headingId} className='category__title'>{translate(title, locale)}</h2>
      {description !== undefined && <p className='category__description'>{translate(description, locale)}</p>}

      {rowCount === 0
        ? <p className='category__summary'>{text('empty')}</p>
        : (
          <>
            <p className='category__summary'>{summaryLine}</p>
            <label className='category__include'>
              <input type='checkbox' checked={included} onChange={(e) => setIncluded(e.target.checked)} />
              <span>{text('include')}</span>
            </label>
            {!included && <p className='category__note'>{text('excluded')}</p>}
            {included && (
              <>
                <h3 className='category__label'>{text('examples')}</h3>
                <RowTable labels={labels} rows={examples} deleted={deleted} text={text} caption={`${translate(title, locale)}: ${text('examples')}`} />
                <button
                  type='button'
                  className='category__link btn-focus'
                  aria-expanded={inspecting}
                  aria-controls={inspectorId}
                  onClick={() => setInspecting(!inspecting)}
                >
                  {text(inspecting ? 'hide' : 'inspect')}
                </button>
                <div id={inspectorId}>
                  {inspecting && (
                    <Inspector id={id} title={translate(title, locale)} channel={channel} labels={labels} deleted={deleted} onDelete={toggleDeleted} text={text} number={number} />
                  )}
                </div>
                {deleted.size > 0 && (
                  <p className='category__note'>
                    {text('deletedCount', { n: number(deleted.size) })}{' '}
                    <button type='button' className='category__link btn-focus' onClick={() => setDeleted(new Set())}>{text('restoreAll')}</button>
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
  text: Text
  caption: string
  selection?: { selected: Set<number>, toggle: (id: number) => void, restore: (id: number) => void }
}> = ({ labels, rows, deleted, text, caption, selection }) => (
  <div className='category__table-wrap'>
    <table className={`category__table ${selection !== undefined ? 'category__table--selectable' : ''}`}>
      <caption className='sr-only'>{caption}</caption>
      <thead>
        <tr>
          {selection !== undefined && <th scope='col' className='category__select'><span className='sr-only'>{text('select')}</span></th>}
          {labels.map((label) => <th scope='col' key={label}>{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isDeleted = deleted.has(row.id)
          const n = String(row.id + 1)
          return (
            <tr key={row.id} className={isDeleted ? 'category__row--deleted' : ''}>
              {selection !== undefined && (
                <td className='category__select'>
                  {isDeleted
                    ? <button type='button' className='category__link btn-focus' aria-label={text('restoreEntry', { n })} onClick={() => selection.restore(row.id)}>{text('restore')}</button>
                    : <input type='checkbox' aria-label={text('selectEntry', { n })} checked={selection.selected.has(row.id)} onChange={() => selection.toggle(row.id)} />}
                </td>
              )}
              {row.cells.map((cell, c) => (
                // data-label heads each value when the table is stacked on narrow screens.
                <td key={c} data-label={labels[c]} title={display(cell)}>
                  {display(cell)}
                  {isDeleted && c === 0 && <span className='sr-only'> ({text('deleted')})</span>}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)

const Inspector: React.FC<{
  id: string
  title: string
  channel: string
  labels: string[]
  deleted: Set<number>
  onDelete: (ids: number[], remove: boolean) => void
  text: Text
  number: (n: number) => string
}> = ({ id, title, channel, labels, deleted, onDelete, text, number }) => {
  const fetchRows = useRowSource(channel)
  const searchId = useId()
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

  const status = failed
    ? text('failed')
    : page === null
      ? text('loading')
      : page.total === 0
        ? text('none')
        : text('shown', { first: number(offset + 1), last: number(Math.min(offset + PAGE_SIZE, page.total)), total: number(page.total) })

  return (
    <div className='category__inspector'>
      <label htmlFor={searchId} className='category__search-label'>{text('search')}</label>
      <input id={searchId} type='search' className='category__search' value={search} onChange={(e) => setSearch(e.target.value)} />
      {/* Announced when the page, the search or the loading state changes. */}
      <p className='category__status' role='status' aria-live='polite'>{status}</p>
      {page !== null && page.total > 0 && (
        <>
          {/* Above the rows, so it is near at hand: tick entries, then Shift+Tab back to delete them. */}
          <div className='category__pager' role='toolbar' aria-label={title}>
            <button type='button' className='btn-focus' disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{text('previous')}</button>
            <button type='button' className='btn-focus' disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>{text('next')}</button>
            <button
              type='button'
              className='category__delete btn-focus'
              disabled={selected.size === 0}
              onClick={() => { onDelete([...selected], true); setSelected(new Set()) }}
            >
              {text('deleteSelected', { n: number(selected.size) })}
            </button>
          </div>
          <RowTable
            labels={labels}
            rows={page.rows}
            deleted={deleted}
            text={text}
            caption={`${title}: ${status}`}
            selection={{ selected, toggle, restore: (rowId) => onDelete([rowId], false) }}
          />
        </>
      )}
    </div>
  )
}
