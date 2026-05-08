import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: (() => {
    const base = PrismaAdapter(prisma)
    return {
      ...base,
      createUser: async (data: { name?: string | null; email: string; emailVerified?: Date | null; image?: string | null }) => {
        return prisma.user.create({
          data: {
            ...data,
            displayName: (data.name ?? data.email ?? 'User').slice(0, 255),
          },
        })
      },
    }
  })(),
  trustHost: true,
  // JWT sessions — no Session table required; userId threaded via jwt/session callbacks
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth/signin',
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const user = await prisma.user.findUnique({
          where: { email: (credentials.email as string).toLowerCase() },
        })
        if (!user?.passwordHash) return null
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        )
        if (!valid) return null
        return { id: user.id, email: user.email, name: user.displayName }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.userId = user.id
      return token
    },
    session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string
      return session
    },
  },
})
