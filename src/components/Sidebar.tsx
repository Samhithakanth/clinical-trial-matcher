'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
const links=[['/','Dashboard'],['/patients','Patients'],['/clinical-trials','Clinical Trials'],['/matches','Match Results'],['/audit','Audit Logs']];
export default function Sidebar(){const path=usePathname();return <aside className="sidebar"><Link href="/" className="brand">Trial<span>Match</span></Link><div className="nav-label">WORKSPACE</div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href} className={(href==='/'?path==='/':path.startsWith(href))?'active':''}>{label}</Link>)}</nav><div className="side-foot">Clinical Trial Matcher<br/>MySQL · Next.js</div></aside>}
