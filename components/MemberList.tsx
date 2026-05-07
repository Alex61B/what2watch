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
    <div className="rounded-xl bg-white p-4 shadow">
      <h2 className="mb-3 text-sm font-semibold text-gray-500 uppercase tracking-wide">
        {members.length} members
      </h2>
      <ul className="space-y-2">
        {members.map((member) => {
          const isCurrentUser = member.id === currentMemberId
          return (
            <li
              key={member.id}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                isCurrentUser ? 'bg-indigo-50 font-medium' : 'hover:bg-gray-50'
              }`}
            >
              <span>
                {member.displayName}
                {member.isHost && ' (Host)'}
                {isCurrentUser && ' (You)'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
