import { ArrowUpRight } from "lucide-react";

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  iconBg = "bg-green-50",
  iconColor = "text-green-700",
  trend,
}) {
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      {/* TOP */}
      <div className="flex items-start justify-between gap-4">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}
        >
          {Icon && <Icon size={21} strokeWidth={2} />}
        </div>

        {trend && (
          <div className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
            <ArrowUpRight size={13} />
            {trend}
          </div>
        )}
      </div>

      {/* CONTENT */}
      <div className="mt-5">
        <p className="text-sm font-medium text-slate-500">
          {title}
        </p>

        <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          {value}
        </p>

        {description && (
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export default StatCard;