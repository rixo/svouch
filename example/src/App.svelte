<script>
  import { todos } from './db.js'

  // $: console.log($todos)

  const { dirty, busy } = todos

  let input = ''

  const add = () => {
    todos.put({
      text: input,
    })
    input = ''
  }
</script>

<form on:submit|preventDefault={add}>
  <div class="topbar">
    <input bind:value={input} />
    <button type="submit">Add</button>

    <button disabled={!$dirty} on:click={todos.commitManaged}>Save</button>

    <span class="status" hidden={!$dirty}>Dirty</span>
    <span class="status" hidden={!$busy}>Busy</span>
  </div>

  {#each $todos as todo}
    <div class="todo">
      <input bind:value={todo.text} />
      <button type="button" on:click={todos.removeRecord(todo)}>X</button>
    </div>
    <!-- <pre>{JSON.stringify(todo, false, 2)}</pre> -->
  {/each}
</form>

<style>
  .topbar {
    padding: 0.5rem;
    margin: 1em 0;
  }

  .status {
    padding: 0.5em;
  }

  .todo {
    margin: 0.5rem;
  }
</style>
