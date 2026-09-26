import { useEffect, useState } from 'react'
import { MenuItem } from '@blueprintjs/core'
import { Omnibar } from '@blueprintjs/select'
import type { PatientListItem } from '@/api/types'
import { usePatientSearch } from '@/api/hooks'
import { useUi } from '@/state/ui'

/** Spec 14.1: Blueprint Omnibar bound to Ctrl+K / Cmd+K. */
export function PatientSearch() {
  const open = useUi((s) => s.searchOpen)
  const setOpen = useUi((s) => s.setSearchOpen)
  const openPatient = useUi((s) => s.openPatient)
  const [q, setQ] = useState('')
  const results = usePatientSearch(q)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  return (
    <Omnibar<PatientListItem>
      isOpen={open}
      onClose={() => setOpen(false)}
      items={results.data?.items ?? []}
      query={q}
      onQueryChange={setQ}
      itemListPredicate={(_, items) => items}
      onItemSelect={(p) => openPatient(p.id)}
      inputProps={{ placeholder: 'Search patients by name or MRN...' }}
      noResults={
        <MenuItem
          disabled
          text={results.isFetching ? 'Searching...' : 'No patients on your care team match.'}
        />
      }
      itemRenderer={(p, { handleClick, modifiers }) => (
        <MenuItem
          key={p.id}
          active={modifiers.active}
          onClick={handleClick}
          text={p.name}
          label={`${p.age} ${p.sex} · ${p.mrn}`}
          icon="person"
        />
      )}
    />
  )
}
