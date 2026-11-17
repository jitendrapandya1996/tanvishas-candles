-- Store useful Razorpay references, and confirm an order only after a captured
-- payment has been authenticated by the backend/webhook.
alter table public.orders
  add column if not exists razorpay_payment_method text,
  add column if not exists razorpay_reference_id text;

-- Record the selected online method as soon as its provider order is created,
-- so pending payments are not displayed as Cash on Delivery in the admin.
create or replace function public.backend_set_razorpay_order(
  _order_id uuid,
  _razorpay_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders
     set razorpay_order_id = _razorpay_order_id,
         payment_method = 'online'
   where id = _order_id and status <> 'cancelled' and payment_status <> 'paid'
     and (razorpay_order_id is null or razorpay_order_id = _razorpay_order_id);

  if found then return true; end if;
  return exists (
    select 1 from public.orders
     where id = _order_id and status <> 'cancelled'
       and payment_status <> 'paid' and razorpay_order_id = _razorpay_order_id
  );
end;
$$;

revoke all on function public.backend_set_razorpay_order(uuid, text)
  from public, anon, authenticated;
grant execute on function public.backend_set_razorpay_order(uuid, text)
  to service_role;

drop function if exists public.backend_mark_order_paid(uuid, text, text, timestamptz);

create function public.backend_mark_order_paid(
  _order_id uuid,
  _razorpay_order_id text,
  _payment_id text,
  _paid_at timestamptz,
  _payment_method text,
  _reference_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _current record;
begin
  select o.status, o.payment_status, o.razorpay_payment_id
    into _current
    from public.orders as o
   where o.id = _order_id and o.razorpay_order_id = _razorpay_order_id
   for update;

  if not found then return false; end if;
  if _current.payment_status = 'paid'
    and _current.razorpay_payment_id = _payment_id then
    return true;
  end if;
  if _current.razorpay_payment_id is not null
    and _current.razorpay_payment_id <> _payment_id then
    return false;
  end if;

  update public.orders
     set payment_method = 'online',
         payment_status = 'paid',
         razorpay_payment_id = _payment_id,
         razorpay_payment_method = nullif(_payment_method, ''),
         razorpay_reference_id = nullif(_reference_id, ''),
         paid_at = _paid_at,
         status = case
           when status = 'placed' then 'confirmed'::public.order_status
           else status
         end,
         updated_at = _paid_at
   where id = _order_id and razorpay_order_id = _razorpay_order_id;

  if not found then return false; end if;
  if _current.status = 'placed' then
    insert into public.order_status_history (order_id, status, note)
    values (_order_id, 'confirmed', 'Online payment captured and verified by Razorpay.');
  end if;
  return true;
end;
$$;

revoke all on function public.backend_mark_order_paid(uuid, text, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.backend_mark_order_paid(uuid, text, text, timestamptz, text, text)
  to service_role;

-- Delivery may mark COD as collected, but an online order is paid only by a
-- verified Razorpay capture recorded through backend_mark_order_paid().
create or replace function public.admin_update_order(
  _order_id uuid, _status public.order_status, _note text default null,
  _courier text default null, _tracking text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _o record;
  _it record;
  _new integer;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  select * into _o from public.orders where id = _order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if _o.status = 'cancelled' then raise exception 'This order is already cancelled'; end if;
  if _o.status = 'delivered' and _status <> 'delivered' then
    raise exception 'Delivered orders cannot be changed';
  end if;

  update public.orders set status = _status,
    courier = coalesce(nullif(pg_catalog.btrim(_courier), ''), courier),
    tracking_number = coalesce(nullif(pg_catalog.btrim(_tracking), ''), tracking_number),
    payment_status = case
      when _status = 'delivered' and _o.payment_method = 'cod' then 'paid'
      else payment_status
    end,
    updated_at = now()
  where id = _order_id;

  if _status <> _o.status then
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (_order_id, _status, _note, auth.uid());
  end if;

  if _status = 'cancelled' then
    for _it in
      select * from public.order_items where order_id = _order_id and product_id is not null
    loop
      update public.products set stock = stock + _it.quantity
      where id = _it.product_id returning stock into _new;
      if found then
        insert into public.stock_adjustments
          (product_id, change, new_stock, reason, note, changed_by, order_id)
        values (_it.product_id, _it.quantity, _new, 'order_cancelled', 'Cancelled by store', auth.uid(), _order_id);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
