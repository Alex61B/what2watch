import { STREAMING_SERVICES, ServiceId } from '@/lib/tmdb'

// Brand dots so each service stays recognizable whether selected or not.
const SERVICE_DOTS: Record<ServiceId, string> = {
  netflix: 'bg-red-600',
  prime: 'bg-sky-500',
  disney: 'bg-indigo-600',
  hbo: 'bg-purple-600',
  hulu: 'bg-green-500',
  apple: 'bg-zinc-400',
}

interface StreamingServicePickerProps {
  selected: ServiceId[]
  onChange: (services: ServiceId[]) => void
}

export default function StreamingServicePicker({
  selected,
  onChange,
}: StreamingServicePickerProps) {
  function handleToggle(id: ServiceId) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {STREAMING_SERVICES.map((service) => {
        const isSelected = selected.includes(service.id)
        return (
          <button
            key={service.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => handleToggle(service.id)}
            className={[
              'flex items-center gap-2 rounded-none border px-3 py-2.5 text-sm font-medium transition-colors',
              isSelected
                ? 'border-ink bg-ink text-canvas'
                : 'border-line bg-surface text-muted hover:border-ink hover:text-ink',
            ].join(' ')}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SERVICE_DOTS[service.id]}`} />
            <span className="truncate">{service.name}</span>
          </button>
        )
      })}
    </div>
  )
}
