import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function NavBar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="bg-river-700 text-buttontext">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="font-display text-lg font-semibold tracking-tight">
          Fællesrejser
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link to="/" className="hover:text-sand-200">
            Rejser
          </Link>
          <Link to="/arkiv" className="hover:text-sand-200">
            Arkiv
          </Link>
          {profile?.is_admin && (
            <Link to="/admin" className="hover:text-sand-200">
              Admin
            </Link>
          )}
          <span className="hidden text-river-200 sm:inline">{profile?.name}</span>
          <button
            className="rounded-lg bg-river-600 px-3 py-1.5 hover:bg-river-500"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Log ud
          </button>
        </nav>
      </div>
    </header>
  );
}
