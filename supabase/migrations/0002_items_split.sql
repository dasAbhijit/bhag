-- Itemised splits (scan an invoice, then say who had what). Run after 0001. Safe to run again.
-- The items themselves are kept in expenses.split_input; the amounts each person owes are in expense_splits as usual.
alter table public.expenses drop constraint if exists expenses_split_method_check;
alter table public.expenses add constraint expenses_split_method_check
  check (split_method in ('equal', 'exact', 'percent', 'shares', 'items'));

alter table public.recurring_templates drop constraint if exists recurring_templates_split_method_check;
alter table public.recurring_templates add constraint recurring_templates_split_method_check
  check (split_method in ('equal', 'exact', 'percent', 'shares', 'items'));
