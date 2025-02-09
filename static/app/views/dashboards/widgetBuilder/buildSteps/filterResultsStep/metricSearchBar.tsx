import styled from '@emotion/styled';

import type {SearchBarProps} from 'sentry/components/events/searchBar';
import type {PageFilters} from 'sentry/types';
import {getMRI} from 'sentry/utils/metrics/mri';
import type {WidgetQuery} from 'sentry/views/dashboards/types';
import {MetricSearchBar as DDMSearchBar} from 'sentry/views/metrics/metricSearchBar';

interface Props {
  onClose: SearchBarProps['onClose'];
  pageFilters: PageFilters;
  widgetQuery: WidgetQuery;
}

export function MetricSearchBar({pageFilters, widgetQuery, onClose}: Props) {
  const projectIds = pageFilters.projects;
  const mri = getMRI(widgetQuery.aggregates[0] ?? '');

  return (
    <SearchBar
      // TODO(aknaus): clean up projectId type in ddm
      projectIds={projectIds.map(id => id.toString())}
      mri={mri}
      disabled={!mri}
      query={widgetQuery.conditions}
      onChange={() => {}}
      onClose={onClose}
    />
  );
}

const SearchBar = styled(DDMSearchBar)`
  flex-grow: 1;
`;
