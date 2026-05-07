import React from 'react'
import { STREAMING_SERVICES } from '@/lib/tmdb'

type ServiceId = typeof STREAMING_SERVICES[number]['id']

const SERVICE_COLORS: Record<ServiceId, string> = {
  netflix: 'bg-red-600 text-white border-red-600',
  prime:   'bg-blue-600 text-white border-blue-600',
  disney:  'bg-indigo-700 text-white border-indigo-700',
  hbo:     'bg-purple-700 text-white border-purple-700',
  hulu:    'bg-green-600 text-white border-green-600',
  apple:   'bg-gray-600 text-white border-gray-600',
}

interface StreamingServicePickerProps {
  selected: string[]
  onChange: (services: string[]) => void
}

export default function StreamingServicePicker({
  selected,
  onChange,
}: StreamingServicePickerProps) {
  function handleToggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {STREAMING_SERVICES.map((service) => {
        const isSelected = selected.includes(service.id)
        return (
          <button
            key={service.id}
            type="button"
            aria-pressed={isSelected ? 'true' : 'false'}
            onClick={() => handleToggle(service.id)}
            className={[
              'rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors',
              isSelected
                ? SERVICE_COLORS[service.id as ServiceId]
                : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700',
            ].join(' ')}
          >
            {service.name}
          </button>
        )
      })}
    </div>
  )
}
