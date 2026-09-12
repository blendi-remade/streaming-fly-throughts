import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Fly / Thoughts',
  description: 'A simulated fly brain connected to a live cinema.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
