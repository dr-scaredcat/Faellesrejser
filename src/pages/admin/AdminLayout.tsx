import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const SECTIONS = [
  { path: '/admin/generelt', label: 'Generelt' },
  { path: '/admin/design', label: 'Design' },
  { path: '/admin/regnskab', label: 'Regnskab' },
  { path: '/admin/gudenaaen', label: 'Gudenåen' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-river-800">Admin</h1>
        <select
          className="input w-auto"
          value={location.pathname}
          onChange={(e) => navigate(e.target.value)}
        >
          {SECTIONS.map((s) => (
            <option key={s.path} value={s.path}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <Outlet />
    </div>
  );
}
