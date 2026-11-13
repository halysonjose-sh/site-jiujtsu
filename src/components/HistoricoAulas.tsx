import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { BottomSheet } from './BottomSheet'
import { useToast } from './Toast'
import { aulasDoTexto, rotuloAulasFeitas, validaAulasHistorico } from '../domain/alunos'
import { friendlyError } from '../lib/api'

/**
 * Folha: o professor soma aulas ao histórico do aluno — aulas que ele fez fora
 * do aplicativo. Nada é criado no calendário: a quantidade entra no total e na
 * frequência do aluno, como as aulas anteriores informadas no cadastro.
 */
export function HistoricoAulas({
  student,
  mutate,
  onClose,
}: {
  student: { id: string; name: string }
  mutate: (name: string, args?: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [aulas, setAulas] = useState('')
  const [erro, setErro] = useState('')
  const toast = useToast()

  async function somar() {
    const quantidade = aulasDoTexto(aulas)
    const erro = validaAulasHistorico(quantidade)
    if (erro) {
      setErro(erro)
      return
    }
    setErro('')
    try {
      await mutate('add_student_history', { p_user: student.id, p_count: quantidade })
      toast.show(
        `${quantidade === 1 ? 'Aula somada' : `${rotuloAulasFeitas(quantidade)} somadas`} ao histórico de ${student.name}.`,
      )
      onClose()
    } catch (e) {
      setErro(friendlyError(e))
    }
  }

  return (
    <BottomSheet open title="Adicionar aulas ao histórico" onClose={onClose}>
      <div className="menu-list">
        <label className="field">
          <span>Quantas aulas ele fez</span>
          <input
            value={aulas}
            onChange={(e) => setAulas(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            maxLength={5}
            placeholder="Ex.: 4"
          />
        </label>
        <p className="field-help">
          Aulas que o aluno fez fora do aplicativo: somam ao total e à frequência dele. Nada é
          criado no calendário.
        </p>
        {erro && (
          <p className="error-message" role="alert">
            {erro}
          </p>
        )}
        <ActionButton className="primary full" action={somar}>
          <CalendarPlus size={17} /> Adicionar ao histórico
        </ActionButton>
      </div>
    </BottomSheet>
  )
}
