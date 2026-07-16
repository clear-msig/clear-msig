fn main() {
    print!(
        "{}",
        clear_msig_intent::render_vectors_json_pretty().expect("serialize render vectors")
    );
}
