import { createBrowserRouter, redirect } from 'react-router';
import { SETUP_STEPS, type SetupStepName } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { HomePage } from '@/features/home/HomePage';
import { BuildPage } from '@/features/build/BuildPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { SetupWizard } from '@/features/setup/SetupWizard';
import { AppShell } from './AppShell';
import { RouteError } from './RouteError';
import { queryClient } from './queryClient';

const stepPath = (index1: number) => `/setup/${SETUP_STEPS[Math.max(0, Math.min(SETUP_STEPS.length, index1) - 1)]}`;

/** Auth guard (LLD §11.1): no session → /login; setup not finished → resume at her step. */
async function loadMe() {
  try {
    return await queryClient.ensureQueryData({ queryKey: queryKeys.me, queryFn: api.me });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) throw redirect('/login');
    throw err;
  }
}

async function signedInLoader({ request }: { request: Request }) {
  const me = await loadMe();
  // Setup (style, template, courses) is for teachers. Library editors and admins go straight in; an editor lands on
  // her queue rather than the Prepare screen.
  if (me.user.role === 'teacher' && !me.setupDone) throw redirect(stepPath(me.setupStep));
  // Consent withdrawn: nothing works that sends her work out, so she agrees again first. "Your data" stays open, so
  // she can still download or delete everything without agreeing.
  if (me.user.role === 'teacher' && !me.consented && !new URL(request.url).pathname.startsWith('/account')) throw redirect('/setup/consent');
  if (me.user.role === 'library_editor' && new URL(request.url).pathname === '/') throw redirect('/library');
  return null;
}

async function setupLoader({ params }: { params: { step?: string } }) {
  const me = await loadMe();
  // After setup, only the consent step opens again, and only when she has withdrawn it.
  if (me.user.role !== 'teacher') throw redirect('/');
  if (me.setupDone) {
    if (params.step === 'consent' && !me.consented) return null;
    throw redirect('/');
  }
  const requested = SETUP_STEPS.indexOf(params.step as SetupStepName) + 1;
  // She may revisit earlier steps but not jump past where she is.
  if (requested < 1 || requested > me.setupStep) throw redirect(stepPath(me.setupStep));
  return null;
}

async function loginLoader() {
  try {
    await queryClient.fetchQuery({ queryKey: queryKeys.me, queryFn: api.me, staleTime: 0 });
    throw redirect('/');
  } catch (err) {
    if (err instanceof Response) throw err;
  }
  return queryClient.ensureQueryData({ queryKey: queryKeys.authOptions, queryFn: api.authOptions });
}

/** Data-mode router (LLD §11.1). Each feature adds its routes, loaders and lazy chunks as it lands. */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, loader: loginLoader, errorElement: <RouteError /> },
  { path: '/setup/:step', element: <SetupWizard />, loader: setupLoader, errorElement: <RouteError /> },
  {
    path: '/',
    element: <AppShell />,
    loader: signedInLoader,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'build/:lectureId', element: <BuildPage /> },
      // The Studio is the heaviest screen: its own chunk, loaded on demand (LLD §11.1).
      { path: 'library/gaps', lazy: async () => ({ Component: (await import('@/features/library/GapsPage')).GapsPage }) },
      { path: 'library/topics', lazy: async () => ({ Component: (await import('@/features/library/TopicsReviewPage')).TopicsReviewPage }) },
      { path: 'library/reports', lazy: async () => ({ Component: (await import('@/features/library/ReportsQueuePage')).ReportsQueuePage }) },
      { path: 'library', lazy: async () => ({ Component: (await import('@/features/library/LibraryReviewPage')).LibraryReviewPage }) },
      { path: 'account/data', lazy: async () => ({ Component: (await import('@/features/account/AccountDataPage')).AccountDataPage }) },
      { path: 'research', lazy: async () => ({ Component: (await import('@/features/research/ResearchPage')).ResearchPage }) },
      { path: 'research/:runId', lazy: async () => ({ Component: (await import('@/features/research/ResearchRunPage')).ResearchRunPage }) },
      { path: 'explore', lazy: async () => ({ Component: (await import('@/features/explore/ExplorePage')).ExplorePage }) },
      { path: 'explore/:conceptId', lazy: async () => ({ Component: (await import('@/features/explore/TopicPage')).TopicPage }) },
      { path: 'notes', lazy: async () => ({ Component: (await import('@/features/notes/NotesPage')).NotesPage }) },
      { path: 'courses', lazy: async () => ({ Component: (await import('@/features/courses/CourseList')).CourseListPage }) },
      { path: 'courses/:id', lazy: async () => ({ Component: (await import('@/features/courses/CoursePlan')).CoursePlanPage }) },
      { path: 'lectures/:id', lazy: async () => ({ Component: (await import('@/features/studio/StudioPage')).StudioPage }) },
    ],
  },
  { path: '*', element: <RouteError notFound /> },
]);
