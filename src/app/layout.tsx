import type {Metadata} from 'next';import './globals.css';import Sidebar from '@/components/Sidebar';
export const metadata:Metadata={title:'TrialMatch | Clinical Trial Matcher',description:'Healthcare clinical trial matching dashboard'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><div className="shell"><Sidebar/><main className="content">{children}</main></div></body></html>}
