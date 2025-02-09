import {useCallback, useLayoutEffect, useMemo, useRef} from 'react';
import {type Theme, useTheme} from '@emotion/react';
import styled from '@emotion/styled';
import pick from 'lodash/pick';

import type {Tag} from 'sentry/actionCreators/events';
import {Button} from 'sentry/components/button';
import {IconChevron, IconPanel, IconPin} from 'sentry/icons';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {EventTransaction} from 'sentry/types';
import type EventView from 'sentry/utils/discover/eventView';
import {PERFORMANCE_URL_PARAM} from 'sentry/utils/performance/constants';
import type {
  TraceFullDetailed,
  TraceSplitResults,
} from 'sentry/utils/performance/quickTrace/types';
import {
  cancelAnimationTimeout,
  requestAnimationTimeout,
} from 'sentry/utils/profiling/hooks/useVirtualizedTree/virtualizedTreeUtils';
import type {UseApiQueryResult} from 'sentry/utils/queryClient';
import {useApiQuery} from 'sentry/utils/queryClient';
import type RequestError from 'sentry/utils/requestError/requestError';
import {useLocation} from 'sentry/utils/useLocation';
import useOrganization from 'sentry/utils/useOrganization';
import {getTraceQueryParams} from 'sentry/views/performance/newTraceDetails/traceApi/useTrace';
import {TraceVitals} from 'sentry/views/performance/newTraceDetails/traceDrawer/tabs/traceVitals';
import {
  usePassiveResizableDrawer,
  type UsePassiveResizableDrawerOptions,
} from 'sentry/views/performance/newTraceDetails/traceDrawer/usePassiveResizeableDrawer';
import type {VirtualizedViewManager} from 'sentry/views/performance/newTraceDetails/traceRenderers/virtualizedViewManager';
import type {
  TraceReducerAction,
  TraceReducerState,
} from 'sentry/views/performance/newTraceDetails/traceState';
import {TRACE_DRAWER_DEFAULT_SIZES} from 'sentry/views/performance/newTraceDetails/traceState/tracePreferences';
import {
  getTraceTabTitle,
  type TraceTabsReducerState,
} from 'sentry/views/performance/newTraceDetails/traceState/traceTabs';

import {
  makeTraceNodeBarColor,
  type TraceTree,
  type TraceTreeNode,
} from '../traceModels/traceTree';

import {TraceDetails} from './tabs/trace';
import {TraceTreeNodeDetails} from './tabs/traceTreeNodeDetails';

type TraceDrawerProps = {
  manager: VirtualizedViewManager;
  onTabScrollToNode: (node: TraceTreeNode<TraceTree.NodeValue>) => void;
  rootEventResults: UseApiQueryResult<EventTransaction, RequestError>;
  trace: TraceTree;
  traceEventView: EventView;
  traceGridRef: HTMLElement | null;
  trace_dispatch: React.Dispatch<TraceReducerAction>;
  trace_state: TraceReducerState;
  traces: TraceSplitResults<TraceFullDetailed> | null;
};

export function TraceDrawer(props: TraceDrawerProps) {
  const theme = useTheme();
  const location = useLocation();
  const organization = useOrganization();

  // The /events-facets/ endpoint used to fetch tags for the trace tab is slow. Therefore,
  // we try to prefetch the tags as soon as the drawer loads, hoping that the tags will be loaded
  // by the time the user clicks on the trace tab. Also prevents the tags from being refetched.
  const urlParams = useMemo(() => {
    const {timestamp} = getTraceQueryParams(location.query);
    const params = pick(location.query, [
      ...Object.values(PERFORMANCE_URL_PARAM),
      'cursor',
    ]);

    if (timestamp) {
      params.traceTimestamp = timestamp;
    }
    return params;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tagsQueryResults = useApiQuery<Tag[]>(
    [
      `/organizations/${organization.slug}/events-facets/`,
      {
        query: {
          ...urlParams,
          ...props.traceEventView.getFacetsAPIPayload(location),
          cursor: undefined,
        },
      },
    ],
    {
      staleTime: Infinity,
    }
  );

  const traceStateRef = useRef(props.trace_state);
  traceStateRef.current = props.trace_state;

  const trace_dispatch = props.trace_dispatch;

  const initialSizeRef = useRef<Record<string, number> | null>(null);
  if (!initialSizeRef.current) {
    initialSizeRef.current = {};
  }

  const resizeEndRef = useRef<{id: number} | null>(null);
  const onResize = useCallback(
    (size: number, min: number, user?: boolean, minimized?: boolean) => {
      if (!props.traceGridRef) return;

      minimized = minimized ?? traceStateRef.current.preferences.drawer.minimized;

      if (traceStateRef.current.preferences.layout === 'drawer bottom' && user) {
        if (size <= min && !minimized) {
          trace_dispatch({
            type: 'minimize drawer',
            payload: true,
          });
        } else if (size > min && minimized) {
          trace_dispatch({
            type: 'minimize drawer',
            payload: false,
          });
        }
      }

      const {width, height} = props.traceGridRef.getBoundingClientRect();

      const drawerWidth = size / width;
      const drawerHeight = size / height;

      if (resizeEndRef.current) cancelAnimationTimeout(resizeEndRef.current);
      resizeEndRef.current = requestAnimationTimeout(() => {
        if (traceStateRef.current.preferences.drawer.minimized) {
          return;
        }
        const drawer_size =
          traceStateRef.current.preferences.layout === 'drawer bottom'
            ? drawerHeight
            : drawerWidth;

        trace_dispatch({
          type: 'set drawer dimension',
          payload: drawer_size,
        });
      }, 1000);

      if (traceStateRef.current.preferences.layout === 'drawer bottom') {
        min = minimized ? 27 : drawerHeight;
      } else {
        min = minimized ? 0 : drawerWidth;
      }

      if (traceStateRef.current.preferences.layout === 'drawer bottom') {
        props.traceGridRef.style.gridTemplateColumns = `1fr`;
        props.traceGridRef.style.gridTemplateRows = `1fr minmax(${min}px, ${drawerHeight * 100}%)`;
      } else if (traceStateRef.current.preferences.layout === 'drawer left') {
        props.traceGridRef.style.gridTemplateColumns = `minmax(${min}px, ${drawerWidth * 100}%) 1fr`;
        props.traceGridRef.style.gridTemplateRows = '1fr auto';
      } else {
        props.traceGridRef.style.gridTemplateColumns = `1fr minmax(${min}px, ${drawerWidth * 100}%)`;
        props.traceGridRef.style.gridTemplateRows = '1fr auto';
      }
    },
    [props.traceGridRef, trace_dispatch]
  );

  const drawerOptions: Pick<UsePassiveResizableDrawerOptions, 'min' | 'initialSize'> =
    useMemo(() => {
      const initialSizeInPercentage =
        props.trace_state.preferences.drawer.sizes[props.trace_state.preferences.layout];

      // We have a stored user preference for the drawer size
      const {width, height} = props.traceGridRef?.getBoundingClientRect() ?? {
        width: 0,
        height: 0,
      };

      const initialSize =
        props.trace_state.preferences.layout === 'drawer bottom'
          ? height * initialSizeInPercentage
          : width * initialSizeInPercentage;

      return {
        min: props.trace_state.preferences.layout === 'drawer bottom' ? 27 : 300,
        initialSize,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.traceGridRef, props.trace_state.preferences.layout]);

  const resizableDrawerOptions: UsePassiveResizableDrawerOptions = useMemo(() => {
    return {
      ...drawerOptions,
      onResize,
      direction:
        props.trace_state.preferences.layout === 'drawer left'
          ? 'left'
          : props.trace_state.preferences.layout === 'drawer right'
            ? 'right'
            : 'up',
    };
  }, [onResize, drawerOptions, props.trace_state.preferences.layout]);

  const {onMouseDown, size} = usePassiveResizableDrawer(resizableDrawerOptions);
  const onParentClick = useCallback(
    (node: TraceTreeNode<TraceTree.NodeValue>) => {
      props.onTabScrollToNode(node);
      props.trace_dispatch({
        type: 'activate tab',
        payload: node,
        pin_previous: true,
      });
    },
    [props]
  );

  const onMinimizeClick = useCallback(() => {
    trace_dispatch({
      type: 'minimize drawer',
      payload: !props.trace_state.preferences.drawer.minimized,
    });
    if (!props.trace_state.preferences.drawer.minimized) {
      onResize(0, 0, true, true);
      size.current = drawerOptions.min;
    } else {
      onResize(drawerOptions.initialSize, drawerOptions.min, true, false);
      size.current = drawerOptions.initialSize;
    }
  }, [
    size,
    onResize,
    trace_dispatch,
    props.trace_state.preferences.drawer.minimized,
    drawerOptions,
  ]);

  const onDoubleClickResetToDefault = useCallback(() => {
    if (!traceStateRef.current.preferences.drawer.minimized) {
      onMinimizeClick();
      return;
    }

    trace_dispatch({type: 'minimize drawer', payload: false});
    const initialSize = TRACE_DRAWER_DEFAULT_SIZES[props.trace_state.preferences.layout];
    const {width, height} = props.traceGridRef?.getBoundingClientRect() ?? {
      width: 0,
      height: 0,
    };

    const containerSize =
      props.trace_state.preferences.layout === 'drawer bottom' ? height : width;
    const drawer_size = containerSize * initialSize;

    onResize(drawer_size, drawerOptions.min, true, false);
    size.current = drawer_size;
  }, [
    size,
    onMinimizeClick,
    onResize,
    drawerOptions.min,
    props.trace_state.preferences.layout,
    props.traceGridRef,
    trace_dispatch,
  ]);

  const initializedRef = useRef(false);
  useLayoutEffect(() => {
    if (initializedRef.current) return;
    if (props.trace_state.preferences.drawer.minimized && props.traceGridRef) {
      if (traceStateRef.current.preferences.layout === 'drawer bottom') {
        props.traceGridRef.style.gridTemplateColumns = `1fr`;
        props.traceGridRef.style.gridTemplateRows = `1fr minmax(${27}px, 0%)`;
        size.current = 27;
      } else if (traceStateRef.current.preferences.layout === 'drawer left') {
        props.traceGridRef.style.gridTemplateColumns = `minmax(${0}px, 0%) 1fr`;
        props.traceGridRef.style.gridTemplateRows = '1fr auto';
        size.current = 0;
      } else {
        props.traceGridRef.style.gridTemplateColumns = `1fr minmax(${0}px, 0%)`;
        props.traceGridRef.style.gridTemplateRows = '1fr auto';
        size.current = 0;
      }
      initializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.traceGridRef]);

  // Syncs the height of the tabs with the trace indicators
  const hasIndicators =
    props.trace.indicators.length > 0 &&
    props.trace_state.preferences.layout !== 'drawer bottom';

  if (
    props.trace_state.preferences.drawer.minimized &&
    props.trace_state.preferences.layout !== 'drawer bottom'
  ) {
    return (
      <TabsHeightContainer
        absolute
        layout={props.trace_state.preferences.layout}
        hasIndicators={hasIndicators}
      >
        <TabLayoutControlItem>
          <TraceLayoutMinimizeButton
            onClick={onMinimizeClick}
            trace_state={props.trace_state}
          />
        </TabLayoutControlItem>
      </TabsHeightContainer>
    );
  }

  return (
    <PanelWrapper layout={props.trace_state.preferences.layout}>
      <ResizeableHandle
        layout={props.trace_state.preferences.layout}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClickResetToDefault}
      />
      <TabsHeightContainer
        layout={props.trace_state.preferences.layout}
        onDoubleClick={onDoubleClickResetToDefault}
        hasIndicators={hasIndicators}
      >
        <TabsLayout data-test-id="trace-drawer-tabs">
          <TabActions>
            <TabLayoutControlItem>
              <TraceLayoutMinimizeButton
                onClick={onMinimizeClick}
                trace_state={props.trace_state}
              />
            </TabLayoutControlItem>
          </TabActions>
          <TabsContainer
            style={{
              gridTemplateColumns: `repeat(${props.trace_state.tabs.tabs.length + (props.trace_state.tabs.last_clicked_tab ? 1 : 0)}, minmax(0, min-content))`,
            }}
          >
            {/* Renders all open tabs */}
            {props.trace_state.tabs.tabs.map((n, i) => {
              return (
                <TraceDrawerTab
                  key={i}
                  tab={n}
                  index={i}
                  theme={theme}
                  trace={props.trace}
                  trace_state={props.trace_state}
                  trace_dispatch={props.trace_dispatch}
                  onTabScrollToNode={props.onTabScrollToNode}
                  pinned
                />
              );
            })}
            {/* Renders the last tab the user clicked on - this one is ephemeral and might change */}
            {props.trace_state.tabs.last_clicked_tab ? (
              <TraceDrawerTab
                pinned={false}
                key="last-clicked"
                tab={props.trace_state.tabs.last_clicked_tab}
                index={props.trace_state.tabs.tabs.length}
                theme={theme}
                trace_state={props.trace_state}
                trace_dispatch={props.trace_dispatch}
                onTabScrollToNode={props.onTabScrollToNode}
                trace={props.trace}
              />
            ) : null}
          </TabsContainer>
          <TraceLayoutButtons
            trace_dispatch={props.trace_dispatch}
            trace_state={props.trace_state}
          />
        </TabsLayout>
      </TabsHeightContainer>
      {props.trace_state.preferences.drawer.minimized ? null : (
        <Content
          layout={props.trace_state.preferences.layout}
          data-test-id="trace-drawer"
        >
          <ContentWrapper>
            {props.trace_state.tabs.current_tab ? (
              props.trace_state.tabs.current_tab.node === 'trace' ? (
                <TraceDetails
                  tree={props.trace}
                  node={props.trace.root.children[0]}
                  rootEventResults={props.rootEventResults}
                  traces={props.traces}
                  tagsQueryResults={tagsQueryResults}
                  traceEventView={props.traceEventView}
                />
              ) : props.trace_state.tabs.current_tab.node === 'vitals' ? (
                <TraceVitals trace={props.trace} />
              ) : (
                <TraceTreeNodeDetails
                  manager={props.manager}
                  organization={organization}
                  onParentClick={onParentClick}
                  node={props.trace_state.tabs.current_tab.node}
                  onTabScrollToNode={props.onTabScrollToNode}
                />
              )
            ) : null}
          </ContentWrapper>
        </Content>
      )}
    </PanelWrapper>
  );
}

interface TraceDrawerTabProps {
  index: number;
  onTabScrollToNode: (node: TraceTreeNode<TraceTree.NodeValue>) => void;
  pinned: boolean;
  tab: TraceTabsReducerState['tabs'][number];
  theme: Theme;
  trace: TraceTree;
  trace_dispatch: React.Dispatch<TraceReducerAction>;
  trace_state: TraceReducerState;
}
function TraceDrawerTab(props: TraceDrawerTabProps) {
  const node = props.tab.node;

  if (typeof node === 'string') {
    const root = props.trace.root.children[0];
    return (
      <Tab
        data-test-id="trace-drawer-tab"
        className={typeof props.tab.node === 'string' ? 'Static' : ''}
        aria-selected={
          props.tab === props.trace_state.tabs.current_tab ? 'true' : 'false'
        }
        onClick={() => {
          if (props.tab.node !== 'vitals') {
            props.onTabScrollToNode(root);
          }
          props.trace_dispatch({type: 'activate tab', payload: props.index});
        }}
      >
        {/* A trace is technically an entry in the list, so it has a color */}
        {props.tab.node === 'trace' || props.tab.node === 'vitals' ? null : (
          <TabButtonIndicator
            backgroundColor={makeTraceNodeBarColor(props.theme, root)}
          />
        )}
        <TabButton>{props.tab.label ?? node}</TabButton>
      </Tab>
    );
  }

  return (
    <Tab
      data-test-id="trace-drawer-tab"
      aria-selected={props.tab === props.trace_state.tabs.current_tab ? 'true' : 'false'}
      onClick={() => {
        props.onTabScrollToNode(node);
        props.trace_dispatch({type: 'activate tab', payload: props.index});
      }}
    >
      <TabButtonIndicator backgroundColor={makeTraceNodeBarColor(props.theme, node)} />
      <TabButton>{getTraceTabTitle(node)}</TabButton>
      <TabPinButton
        pinned={props.pinned}
        onClick={e => {
          e.stopPropagation();
          props.pinned
            ? props.trace_dispatch({type: 'unpin tab', payload: props.index})
            : props.trace_dispatch({type: 'pin tab'});
        }}
      />
    </Tab>
  );
}

function TraceLayoutButtons(props: {
  trace_dispatch: React.Dispatch<TraceReducerAction>;
  trace_state: TraceReducerState;
}) {
  return (
    <TabActions>
      <TabLayoutControlItem>
        <TabIconButton
          active={props.trace_state.preferences.layout === 'drawer left'}
          onClick={() =>
            props.trace_dispatch({type: 'set layout', payload: 'drawer left'})
          }
          size="xs"
          aria-label={t('Drawer left')}
          icon={<IconPanel size="xs" direction="left" />}
        />
      </TabLayoutControlItem>
      <TabLayoutControlItem>
        <TabIconButton
          active={props.trace_state.preferences.layout === 'drawer bottom'}
          onClick={() =>
            props.trace_dispatch({type: 'set layout', payload: 'drawer bottom'})
          }
          size="xs"
          aria-label={t('Drawer bottom')}
          icon={<IconPanel size="xs" direction="down" />}
        />
      </TabLayoutControlItem>
      <TabLayoutControlItem>
        <TabIconButton
          active={props.trace_state.preferences.layout === 'drawer right'}
          onClick={() =>
            props.trace_dispatch({type: 'set layout', payload: 'drawer right'})
          }
          size="xs"
          aria-label={t('Drawer right')}
          icon={<IconPanel size="xs" direction="right" />}
        />
      </TabLayoutControlItem>
    </TabActions>
  );
}

function TraceLayoutMinimizeButton(props: {
  onClick: () => void;
  trace_state: TraceReducerState;
}) {
  return (
    <TabIconButton
      size="xs"
      active={props.trace_state.preferences.drawer.minimized}
      onClick={props.onClick}
      aria-label={t('Minimize')}
      icon={
        <SmallerChevronIcon
          size="sm"
          isCircled
          direction={
            props.trace_state.preferences.layout === 'drawer bottom'
              ? props.trace_state.preferences.drawer.minimized
                ? 'up'
                : 'down'
              : props.trace_state.preferences.layout === 'drawer left'
                ? props.trace_state.preferences.drawer.minimized
                  ? 'right'
                  : 'left'
                : props.trace_state.preferences.drawer.minimized
                  ? 'left'
                  : 'right'
          }
        />
      }
    />
  );
}

const ResizeableHandle = styled('div')<{
  layout: 'drawer bottom' | 'drawer left' | 'drawer right';
}>`
  width: ${p => (p.layout === 'drawer bottom' ? '100%' : '12px')};
  height: ${p => (p.layout === 'drawer bottom' ? '12px' : '100%')};
  cursor: ${p => (p.layout === 'drawer bottom' ? 'ns-resize' : 'ew-resize')};
  position: absolute;
  top: ${p => (p.layout === 'drawer bottom' ? '-6px' : 0)};
  left: ${p =>
    p.layout === 'drawer bottom' ? 0 : p.layout === 'drawer right' ? '-6px' : 'initial'};
  right: ${p => (p.layout === 'drawer left' ? '-6px' : 0)};

  z-index: 1;
`;

const PanelWrapper = styled('div')<{
  layout: 'drawer bottom' | 'drawer left' | 'drawer right';
}>`
  grid-area: drawer;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
  border-top: ${p =>
    p.layout === 'drawer bottom' ? `1px solid ${p.theme.border}` : 'none'};
  border-left: ${p =>
    p.layout === 'drawer right' ? `1px solid ${p.theme.border}` : 'none'};
  border-right: ${p =>
    p.layout === 'drawer left' ? `1px solid ${p.theme.border}` : 'none'};
  bottom: 0;
  right: 0;
  position: relative;
  background: ${p => p.theme.background};
  color: ${p => p.theme.textColor};
  text-align: left;
  z-index: 10;
`;

const SmallerChevronIcon = styled(IconChevron)`
  width: 13px;
  height: 13px;

  transition: none;
`;

const TabsHeightContainer = styled('div')<{
  hasIndicators: boolean;
  layout: 'drawer bottom' | 'drawer left' | 'drawer right';
  absolute?: boolean;
}>`
  left: ${p => (p.layout === 'drawer left' ? '0' : 'initial')};
  right: ${p => (p.layout === 'drawer right' ? '0' : 'initial')};
  position: ${p => (p.absolute ? 'absolute' : 'relative')};
  height: ${p => (p.hasIndicators ? '44px' : '26px')};
  border-bottom: 1px solid ${p => p.theme.border};
  display: flex;
  flex-direction: column;
  justify-content: end;
`;

const TabsLayout = styled('div')`
  display: grid;
  grid-template-columns: auto 1fr auto;
  padding-left: ${space(0.25)};
  padding-right: ${space(0.5)};
`;

const TabsContainer = styled('ul')`
  display: grid;
  list-style-type: none;
  width: 100%;
  align-items: center;
  justify-content: left;
  gap: ${space(0.5)};
  padding-left: 0;
  margin-bottom: 0;
`;

const TabActions = styled('ul')`
  list-style-type: none;
  padding-left: 0;
  margin-bottom: 0;
  flex: none;

  button {
    padding: 0 ${space(0.5)};
  }
`;

const TabLayoutControlItem = styled('li')`
  display: inline-block;
  margin: 0;
`;

const Tab = styled('li')`
  height: 100%;
  border-top: 2px solid transparent;
  display: flex;
  align-items: center;
  border-bottom: 2px solid transparent;
  padding: 0 ${space(0.25)};
  position: relative;

  &.Static + li:not(.Static) {
    margin-left: ${space(2)};

    &:after {
      display: block;
      content: '';
      position: absolute;
      left: -14px;
      top: 50%;
      transform: translateY(-50%);
      height: 72%;
      width: 1px;
      background-color: ${p => p.theme.border};
    }
  }

  &:hover {
    border-bottom: 2px solid ${p => p.theme.blue200};

    button:last-child {
      transition: all 0.3s ease-in-out 500ms;
      transform: scale(1);
      opacity: 1;
    }
  }
  &[aria-selected='true'] {
    border-bottom: 2px solid ${p => p.theme.blue400};
  }
`;

const TabButtonIndicator = styled('div')<{backgroundColor: string}>`
  width: 12px;
  height: 12px;
  min-width: 12px;
  border-radius: 2px;
  margin-right: ${space(0.25)};
  background-color: ${p => p.backgroundColor};
`;

const TabButton = styled('button')`
  height: 100%;
  border: none;
  max-width: 66ch;

  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  border-radius: 0;
  margin: 0;
  padding: 0 ${space(0.25)};
  font-size: ${p => p.theme.fontSizeSmall};
  color: ${p => p.theme.textColor};
  background: transparent;
`;

const Content = styled('div')<{layout: 'drawer bottom' | 'drawer left' | 'drawer right'}>`
  position: relative;
  overflow: auto;
  padding: ${space(1)};
  flex: 1;

  td {
    max-width: 100% !important;
  }

  ${p =>
    p.layout !== 'drawer bottom' &&
    `
        table {
          display: flex;
        }

        tbody {
          flex: 1;
        }

        tr {
          display: grid;
        }
      `}
`;

const TabIconButton = styled(Button)<{active: boolean}>`
  border: none;
  background-color: transparent;
  box-shadow: none;
  transition: none !important;
  opacity: ${p => (p.active ? 0.7 : 0.5)};

  &:not(:last-child) {
    margin-right: ${space(1)};
  }

  &:hover {
    border: none;
    background-color: transparent;
    box-shadow: none;
    opacity: ${p => (p.active ? 0.6 : 0.5)};
  }
`;

function TabPinButton(props: {
  pinned: boolean;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <PinButton
      size="zero"
      data-test-id="trace-drawer-tab-pin-button"
      onClick={props.onClick}
    >
      <StyledIconPin size="xs" isSolid={props.pinned} />
    </PinButton>
  );
}

const PinButton = styled(Button)`
  padding: ${space(0.5)};
  margin: 0;
  background-color: transparent;
  border: none;

  &:hover {
    background-color: transparent;
  }
`;

const StyledIconPin = styled(IconPin)`
  background-color: transparent;
  border: none;
`;

const ContentWrapper = styled('div')`
  inset: ${space(1)};
  position: absolute;
`;
