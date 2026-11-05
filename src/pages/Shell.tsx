import { NavLink, Outlet } from 'react-router-dom'
import { useRealtime } from '../data/hooks'

const LINKS = [
  { to: '/', label: 'Groups', ico: '👥', end: true },
  { to: '/friends', label: 'Friends', ico: '🤝', end: false },
  { to: '/account', label: 'Account', ico: '⚙️', end: false },
]

export default function Shell() {
  useRealtime()
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <NavLink to="/" className="brand">
            Bhag
          </NavLink>
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <Outlet />
      <nav className="tabbar" aria-label="Main">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            <span className="ico" aria-hidden="true">
              {l.ico}
            </span>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
