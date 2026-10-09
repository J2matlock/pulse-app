/**
 * HelpDemos — Re-exports all demo components from help-demos/ directory.
 * Each demo is lazy-loaded to reduce initial bundle size.
 */
import React, { Suspense } from 'react'

const LazyDemoCellEdit = React.lazy(() => import('./help-demos/DemoCellEdit').then(m => ({ default: m.DemoCellEdit })))
const LazyDemoDeadlineColors = React.lazy(() => import('./help-demos/DemoDeadlineColors').then(m => ({ default: m.DemoDeadlineColors })))
const LazyDemoRightClick = React.lazy(() => import('./help-demos/DemoRightClick').then(m => ({ default: m.DemoRightClick })))
const LazyDemoImportFlow = React.lazy(() => import('./help-demos/DemoImportFlow').then(m => ({ default: m.DemoImportFlow })))
const LazyDemoFilterChips = React.lazy(() => import('./help-demos/DemoFilterChips').then(m => ({ default: m.DemoFilterChips })))
const LazyDemoUndoRedo = React.lazy(() => import('./help-demos/DemoUndoRedo').then(m => ({ default: m.DemoUndoRedo })))
const LazyDemoPasswordChange = React.lazy(() => import('./help-demos/DemoPasswordChange').then(m => ({ default: m.DemoPasswordChange })))
const LazyDemoSearchFilter = React.lazy(() => import('./help-demos/DemoSearchFilter').then(m => ({ default: m.DemoSearchFilter })))
const LazyDemoGrouping = React.lazy(() => import('./help-demos/DemoGrouping').then(m => ({ default: m.DemoGrouping })))
const LazyDemoSnippetExpand = React.lazy(() => import('./help-demos/DemoSnippetExpand').then(m => ({ default: m.DemoSnippetExpand })))
const LazyDemoAvailabilityStatus = React.lazy(() => import('./help-demos/DemoAvailabilityStatus').then(m => ({ default: m.DemoAvailabilityStatus })))
const LazyDemoMultipleCaseloads = React.lazy(() => import('./help-demos/DemoMultipleCaseloads').then(m => ({ default: m.DemoMultipleCaseloads })))
const LazyDemoActivityTimeline = React.lazy(() => import('./help-demos/DemoActivityTimeline').then(m => ({ default: m.DemoActivityTimeline })))
const LazyDemoDashboardOverview = React.lazy(() => import('./help-demos/DemoDashboardOverview').then(m => ({ default: m.DemoDashboardOverview })))
const LazyDemoContactLink = React.lazy(() => import('./help-demos/DemoContactLink').then(m => ({ default: m.DemoContactLink })))
const LazyDemoCaseLog = React.lazy(() => import('./help-demos/DemoCaseLog').then(m => ({ default: m.DemoCaseLog })))
const LazyDemoRecoveryKey = React.lazy(() => import('./help-demos/DemoRecoveryKey').then(m => ({ default: m.DemoRecoveryKey })))
const LazyDemoTaskPriorities = React.lazy(() => import('./help-demos/DemoTaskPriorities').then(m => ({ default: m.DemoTaskPriorities })))
const LazyDemoContactCategories = React.lazy(() => import('./help-demos/DemoContactCategories').then(m => ({ default: m.DemoContactCategories })))
const LazyDemoKeyboardNav = React.lazy(() => import('./help-demos/DemoKeyboardNav').then(m => ({ default: m.DemoKeyboardNav })))

function DemoFallback() {
  return <div className="my-3 h-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 animate-pulse" />
}

function wrap(Component: React.ComponentType) {
  return function WrappedDemo() {
    return (
      <Suspense fallback={<DemoFallback />}>
        <Component />
      </Suspense>
    )
  }
}

export const DemoCellEdit = wrap(LazyDemoCellEdit)
export const DemoDeadlineColors = wrap(LazyDemoDeadlineColors)
export const DemoRightClick = wrap(LazyDemoRightClick)
export const DemoImportFlow = wrap(LazyDemoImportFlow)
export const DemoFilterChips = wrap(LazyDemoFilterChips)
export const DemoUndoRedo = wrap(LazyDemoUndoRedo)
export const DemoPasswordChange = wrap(LazyDemoPasswordChange)
export const DemoSearchFilter = wrap(LazyDemoSearchFilter)
export const DemoGrouping = wrap(LazyDemoGrouping)
export const DemoSnippetExpand = wrap(LazyDemoSnippetExpand)
export const DemoAvailabilityStatus = wrap(LazyDemoAvailabilityStatus)
export const DemoMultipleCaseloads = wrap(LazyDemoMultipleCaseloads)
export const DemoActivityTimeline = wrap(LazyDemoActivityTimeline)
export const DemoDashboardOverview = wrap(LazyDemoDashboardOverview)
export const DemoContactLink = wrap(LazyDemoContactLink)
export const DemoCaseLog = wrap(LazyDemoCaseLog)
export const DemoRecoveryKey = wrap(LazyDemoRecoveryKey)
export const DemoTaskPriorities = wrap(LazyDemoTaskPriorities)
export const DemoContactCategories = wrap(LazyDemoContactCategories)
export const DemoKeyboardNav = wrap(LazyDemoKeyboardNav)
