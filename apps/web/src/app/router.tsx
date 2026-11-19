import { createBrowserRouter } from 'react-router';
import { HomePage } from '@/features/home/HomePage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RouteError } from './RouteError';

/** Data-mode router (LLD §11.1). More routes, loaders and lazy chunks arrive with each feature. */
export const router = createBrowserRouter([
  { path: '/', element: <HomePage />, errorElement: <RouteError /> },
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '*', element: <RouteError notFound /> },
]);
