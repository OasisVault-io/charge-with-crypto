import { redirect } from 'react-router'

export async function loader() {
  throw redirect('/dashboard')
}

export default function Home() {
  return null
}
