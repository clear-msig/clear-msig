fn main() {
    print!(
        "{}",
        clear_msig_intent::registry_json_pretty().expect("serialize intent registry")
    );
}
