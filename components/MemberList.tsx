interface Member {
  id: string
  displayName: string
  isHost: boolean
}

interface MemberListProps {
  members: Member[]
  currentMemberId: string
}

export default function MemberList({ members, currentMemberId }: MemberListProps) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {members.map((member) => {
        const isCurrentUser = member.id === currentMemberId
        return (
          <li
            key={member.id}
            className="flex items-center gap-2.5 border border-line bg-surface px-3 py-2.5 text-sm"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-accent text-xs font-bold text-accent-ink">
              {member.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="truncate font-medium text-ink">
              {member.displayName}
              {member.isHost && <span className="text-faint"> · Host</span>}
              {isCurrentUser && <span className="text-faint"> · You</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
