/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { SearchBar } from '@/components/SearchBar'
import { useSearchTerm } from '@/hooks/useQueryParamState'
import { getUiText } from '@/lib/uiText'

export const ListRunsSearch = () => {
  const { searchTermInput, setSearchTerm } = useSearchTerm()

  return (
    <SearchBar
      placeholder={getUiText('searchRuns')}
      value={searchTermInput ?? undefined}
      onChange={(e) => setSearchTerm(e.target.value)}
      onClear={() => setSearchTerm('')}
    />
  )
}
